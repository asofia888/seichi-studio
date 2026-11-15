/**
 * Video Exporter Service
 * Renders the timeline frame by frame (faster than real time, unaffected by background tabs)
 * and encodes it with WebCodecs into an MP4 (H.264 + AAC), or WebM (VP9/VP8 + Opus) where the
 * browser cannot encode H.264/AAC, at 1080p or 4K and 24/30/60 fps. Video clips are decoded
 * frame-accurately, and the soundtrack is a complete offline mixdown (narration, BGM with
 * auto-ducking, ambience, video clip sound, fades), brought to the target loudness with its peaks
 * limited. The soundtrack is produced ten seconds at a time alongside the picture, so its memory
 * use does not grow with the length of the video. The file is kept in memory, or written
 * straight to a file the user picked (long videos).
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type OutputFormat,
  type StreamTargetChunk,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import { ProjectData, SupportedLanguage, VideoClipItem } from '../types';
import { canvasRenderer, DecodedFrame } from './canvasRenderer';
import { pictureAt, pictureLayers } from './composition';
import { MasteringChain, planMastering } from './mastering';
import { MIX_SAMPLE_RATE } from './soundtrack';
import { MIX_BLOCK_SEC, SoundtrackMixer, toAudioBuffer } from './soundtrackMixer';

export interface ExportProgress {
  percentage: number;
  statusText: string;
}

export type ExportResolution = '1080p' | '2160p';
export type ExportFrameRate = 24 | 30 | 60;

export interface ExportSettings {
  /** Language of the burned-in telops */
  lang: SupportedLanguage;
  /** Loudness the soundtrack is brought to (LUFS); null leaves it as mixed and only limits the peaks */
  targetLufs: number | null;
  resolution: ExportResolution;
  fps: ExportFrameRate;
}

/**
 * A file opened for writing with the File System Access API (Chrome / Edge). Nothing written
 * to it shows up in the file until it is closed; `abort` throws it all away.
 */
export interface WritableFile {
  write(chunk: { type: 'write'; position: number; data: Uint8Array }): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface ExportOptions extends ExportSettings {
  /** From chooseExportFormat (chosen here when left out) */
  format?: ExportFormat;
  /** Write the video straight into this file instead of keeping it in memory */
  destination?: WritableFile | null;
}

/** How loud the exported soundtrack is */
export interface SoundtrackLevels {
  /** Integrated loudness (LUFS); null when it is too quiet or short to measure */
  lufs: number | null;
  /** Gain applied to the whole mix to reach the target (dB) */
  gainDb: number;
  /** Loudest sample (dBFS) */
  peakDb: number;
}

export interface ExportResult {
  /** The video, or null when it was written straight to `destination` */
  blob: Blob | null;
  fileExtension: 'mp4' | 'webm';
  formatLabel: string;
  /** Problems that did not stop the export (e.g. a clip that could not be decoded) */
  warnings: string[];
  /** Null when the video has no sound */
  soundtrack: SoundtrackLevels | null;
}

export class ExportCanceledError extends Error {
  constructor() {
    super('書き出しを中止しました。');
  }
}

const SAMPLE_RATE = MIX_SAMPLE_RATE;

/** Output size: the 1920x1080 (or 1080x1920) layout, doubled for 4K */
export function exportSize(project: ProjectData, resolution: ExportResolution) {
  const scale = resolution === '2160p' ? 2 : 1;
  const isLandscape = project.aspectRatio === '16:9';
  return { width: (isLandscape ? 1920 : 1080) * scale, height: (isLandscape ? 1080 : 1920) * scale, scale };
}

/** YouTube's recommended bitrates for SDR uploads */
export function videoBitrate(resolution: ExportResolution, fps: ExportFrameRate): number {
  const isHighFrameRate = fps > 30;
  if (resolution === '2160p') return isHighFrameRate ? 60_000_000 : 40_000_000;
  return isHighFrameRate ? 12_000_000 : 8_000_000;
}

/** The file an export produces, decided before it starts so a save dialog can offer the right name */
export interface ExportFormat {
  format: OutputFormat;
  videoCodec: VideoCodec;
  /** Null when nothing in the project can be heard */
  audioCodec: AudioCodec | null;
  fileExtension: 'mp4' | 'webm';
  mimeType: string;
}

/** Whether anything in the project can be heard: then the file needs a sound track */
function hasSound(project: ProjectData): boolean {
  const muted = project.mutedTracks || {};
  return (
    project.audioTracks.some((t) => !muted[t.type] && !!t.dataUrl && t.volume > 0) ||
    (!muted.video && project.videoClips.some((c) => c.type === 'video' && !!c.dataUrl && (c.volume ?? 1) > 0))
  );
}

export async function chooseExportFormat(project: ProjectData, settings: ExportSettings): Promise<ExportFormat> {
  const { width, height } = exportSize(project, settings.resolution);
  const bitrate = videoBitrate(settings.resolution, settings.fps);
  const needsAudio = hasSound(project);
  const audioOptions = { numberOfChannels: 2, sampleRate: SAMPLE_RATE };

  const avc = await getFirstEncodableVideoCodec(['avc'], { width, height, bitrate });
  const aac = needsAudio ? await getFirstEncodableAudioCodec(['aac'], audioOptions) : null;
  if (avc && (aac || !needsAudio)) {
    return {
      format: new Mp4OutputFormat({ fastStart: false }), // metadata at the end keeps memory use to one copy
      videoCodec: avc,
      audioCodec: aac,
      fileExtension: 'mp4',
      mimeType: 'video/mp4',
    };
  }

  const vp = await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width, height, bitrate });
  const opus = needsAudio ? await getFirstEncodableAudioCodec(['opus'], audioOptions) : null;
  if (vp && (opus || !needsAudio)) {
    return { format: new WebMOutputFormat(), videoCodec: vp, audioCodec: opus, fileExtension: 'webm', mimeType: 'video/webm' };
  }

  throw new Error(
    settings.resolution === '2160p'
      ? 'このブラウザ（またはパソコン）は 4K の書き出しに対応していません。1080p でお試しください。'
      : 'このブラウザは動画の書き出し（エンコード）に対応していません。最新版のChromeまたはEdgeでお試しください。'
  );
}

/**
 * The stream the encoder writes into `file`. The file keeps what was written only once `keep()`
 * has been called (just before the export finishes); a canceled or failed export leaves no
 * half-written file behind.
 */
function streamInto(file: WritableFile) {
  let isKept = false;
  const stream = new WritableStream<StreamTargetChunk>({
    write: (chunk) => file.write({ type: 'write', position: chunk.position, data: chunk.data }),
    close: () => (isKept ? file.close() : file.abort()),
    abort: () => file.abort(),
  });
  return { stream, keep: () => (isKept = true) };
}

// ---------------------------------------------------------------------------
// Frame-accurate video clip decoding
// ---------------------------------------------------------------------------

interface ClipFrameReader {
  frames: AsyncGenerator<WrappedCanvas | null, void, unknown>;
  input: Input;
  remaining: number;
  lastFrame: WrappedCanvas | null;
}

/**
 * Decodes the frames each video clip needs, in timeline order, so every exported frame
 * shows exactly the right picture. Readers open on first use and close when their clip is done.
 */
class VideoFrameProvider {
  private readers = new Map<string, ClipFrameReader | null>();

  constructor(
    private plan: Map<string, number[]>,
    private width: number,
    private height: number,
    private warnings: string[]
  ) {}

  async frameFor(clip: VideoClipItem): Promise<DecodedFrame | null> {
    let reader = this.readers.get(clip.id);
    if (reader === undefined) {
      reader = await this.open(clip);
      this.readers.set(clip.id, reader);
    }
    if (!reader) return null;

    const next = await reader.frames.next();
    reader.remaining--;
    // Past the end of the source video, hold its last frame
    const frame = (!next.done && next.value) || reader.lastFrame;
    reader.lastFrame = frame;
    const result = frame ? { image: frame.canvas, width: frame.canvas.width, height: frame.canvas.height } : null;

    if (reader.remaining <= 0) {
      await this.closeReader(reader);
      this.readers.set(clip.id, null);
    }
    return result;
  }

  private async open(clip: VideoClipItem): Promise<ClipFrameReader | null> {
    const times = this.plan.get(clip.id) || [];
    if (!clip.dataUrl || times.length === 0) return null;
    let input: Input | null = null;
    try {
      const blob = await (await fetch(clip.dataUrl)).blob();
      input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        throw new Error('unsupported codec');
      }
      const firstTimestamp = await track.getFirstTimestamp();
      const sink = new CanvasSink(track, { width: this.width, height: this.height, fit: 'cover', poolSize: 2 });
      return {
        frames: sink.canvasesAtTimestamps(times.map((t) => t + firstTimestamp)),
        input,
        remaining: times.length,
        lastFrame: null,
      };
    } catch (e) {
      console.warn(`Could not decode video clip ${clip.name}:`, e);
      input?.dispose();
      this.warnings.push(`動画「${clip.name}」はこのブラウザで読み込めない形式のため、映像なしで書き出しました。`);
      return null;
    }
  }

  private async closeReader(reader: ClipFrameReader) {
    await reader.frames.return(undefined).catch(() => {});
    reader.input.dispose();
  }

  async dispose() {
    for (const reader of this.readers.values()) {
      if (reader) await this.closeReader(reader);
    }
    this.readers.clear();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Every string the renderer may draw, so the web fonts can load all needed glyph subsets up front */
function collectProjectText(project: ProjectData, lang: SupportedLanguage): string {
  const parts: string[] = [
    '⛩️📍【】御祭神ご利益所在地最寄り駅駐車場参拝時間アクセス案内作法心得',
    'DeityBlessingEnshrinedAddressTransitParkingHoursAccesto0123456789°NE.,:-…',
  ];
  const b = project.branding;
  for (const t of [b.opTitle, b.opSubtitle, b.edTitle, b.edSubtitle]) parts.push(t.ja, t[lang]);
  for (const s of project.subtitles) {
    parts.push(s.text.ja, s.text[lang]);
    const meta = s.sanctuaryMeta;
    if (meta) for (const t of [meta.name, meta.location, meta.deity, meta.blessing]) parts.push(t.ja, t[lang]);
    if (s.etiquetteTip) for (const t of [s.etiquetteTip.title, s.etiquetteTip.detail]) parts.push(t.ja, t[lang]);
  }
  for (const a of project.accessCards) {
    for (const t of [a.sanctuaryName, a.address, a.nearestStation, a.parking, a.visitingHours]) parts.push(t.ja, t[lang]);
    parts.push(a.attribution);
  }
  return [...new Set(parts.filter(Boolean).join(''))].join('');
}

async function loadFonts(project: ProjectData, lang: SupportedLanguage) {
  const text = collectProjectText(project, lang);
  const fontSpecs = [
    "500 20px 'Shippori Mincho'",
    "600 20px 'Shippori Mincho'",
    "700 20px 'Shippori Mincho'",
    "400 20px 'Noto Serif JP'",
    "500 20px 'Noto Serif JP'",
    "600 20px 'Noto Serif JP'",
    "700 20px 'Noto Serif JP'",
  ];
  // Japanese web fonts are split by character range; loading with the actual text fetches every range needed
  await Promise.all(fontSpecs.map((spec) => document.fonts.load(spec, text).catch(() => [])));
}

// Yield so the progress bar can repaint and the cancel button stays responsive.
// MessageChannel is used instead of setTimeout, which background tabs throttle to once per second.
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

export async function exportProjectVideo(
  project: ProjectData,
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal
): Promise<ExportResult> {
  const { lang: exportLang, targetLufs, fps, destination } = options;
  const { width, height, scale } = exportSize(project, options.resolution);
  const duration = Math.max(1, project.duration);
  const totalFrames = Math.ceil(duration * fps);
  const warnings: string[] = [];
  const checkCanceled = () => {
    if (signal?.aborted) throw new ExportCanceledError();
  };
  // A picked file nobody writes to (an error before encoding) is let go without changing it
  let fileStream: ReturnType<typeof streamInto> | null = null;
  let mixer: SoundtrackMixer | null = null;
  const releaseUnusedFile = () => {
    if (destination && !fileStream) destination.abort().catch(() => {});
  };

  try {
    // 1. Fonts and images, so the first frames are not drawn with fallbacks
    onProgress?.({ percentage: 2, statusText: 'フォントと素材を準備中...' });
    const chosen = options.format ?? (await chooseExportFormat(project, options));
    await loadFonts(project, exportLang);
    for (const clip of project.videoClips) {
      if (clip.type === 'image' && clip.dataUrl) {
        await canvasRenderer.preloadImage(clip.dataUrl).catch(() => {
          warnings.push(`写真「${clip.name}」を読み込めなかったため、背景のみで書き出しました。`);
        });
      }
    }
    for (const card of project.accessCards) {
      if (card.mapMode === 'custom_image' && card.customMapDataUrl) {
        await canvasRenderer.preloadImage(card.customMapDataUrl).catch(() => {
          warnings.push('アクセスカードの地図画像を読み込めなかったため、簡易地図で書き出しました。');
        });
      }
    }
    checkCanceled();

    // 2. Soundtrack: find out how loud the mix is, and with that what to do to it. The sound
    // itself is produced later, block by block, as the picture gets there.
    onProgress?.({ percentage: 5, statusText: '音声を準備中...' });
    mixer = chosen.audioCodec ? await SoundtrackMixer.open(project, duration, warnings) : null;
    checkCanceled();
    let mastering: MasteringChain | null = null;
    if (mixer) {
      const opened = mixer;
      let pass = 0;
      const readMix = () => {
        const passStart = 5 + Math.min(pass++, 1) * 2;
        return opened.blocks((index) => {
          checkCanceled();
          onProgress?.({
            percentage: Math.floor(passStart + (index / opened.blockCount) * 2),
            statusText: `音量を ${targetLufs} LUFS にそろえています（ダッキング・フェードを反映）...`,
          });
        });
      };
      mastering = new MasteringChain(2, SAMPLE_RATE, await planMastering(readMix, 2, SAMPLE_RATE, targetLufs));
      checkCanceled();
    }

    // 3. Encoder setup
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    if (destination) fileStream = streamInto(destination);
    const target = fileStream ? new StreamTarget(fileStream.stream, { chunked: true }) : new BufferTarget();
    const output = new Output({ format: chosen.format, target });
    const videoSource = new CanvasSource(canvas, { codec: chosen.videoCodec, bitrate: videoBitrate(options.resolution, fps) });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioBufferSource | null = null;
    if (mixer && chosen.audioCodec) {
      audioSource = new AudioBufferSource({ codec: chosen.audioCodec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
    // Mix, master and encode the next ten seconds of sound; after the last block, what the limiter still holds
    let soundBlocks = 0;
    const encodeNextSoundBlock = async () => {
      if (!mixer || !mastering || !audioSource) return;
      const finished = mastering.process(await mixer.render(soundBlocks++));
      if (finished[0].length > 0) await audioSource.add(toAudioBuffer(finished));
      if (soundBlocks === mixer.blockCount) {
        const rest = mastering.flush();
        if (rest[0].length > 0) await audioSource.add(toAudioBuffer(rest));
        audioSource.close();
      }
    };

    // Which source timestamps each video clip will be asked for, in frame order
    // (during a dissolve or under a B-roll clip, two clips are on screen at once)
    const videoLayersAt = (t: number) => pictureLayers(pictureAt(project, t)).filter((l) => l.clip.type === 'video');
    const plan = new Map<string, number[]>();
    for (let f = 0; f < totalFrames; f++) {
      for (const layer of videoLayersAt(f / fps)) {
        if (!plan.has(layer.clip.id)) plan.set(layer.clip.id, []);
        plan.get(layer.clip.id)!.push(layer.sourceTime);
      }
    }
    const frames = new VideoFrameProvider(plan, width, height, warnings);

    try {
      await output.start();

      // 4. Frames, rendered at exact timestamps (no real-time pacing, so audio and video cannot drift),
      // each stretch of sound just before the picture it belongs to
      for (let f = 0; f < totalFrames; f++) {
        checkCanceled();
        const t = f / fps;
        while (mixer && soundBlocks < mixer.blockCount && soundBlocks * MIX_BLOCK_SEC <= t) await encodeNextSoundBlock();
        const videoFrames = new Map<string, DecodedFrame | null>();
        for (const layer of videoLayersAt(t)) {
          videoFrames.set(layer.clip.id, await frames.frameFor(layer.clip));
        }

        canvasRenderer.renderFrame(ctx, project, t, exportLang, false, { videoFrames, pixelScale: scale });
        await videoSource.add(t, 1 / fps);

        if (f % 10 === 0 || f === totalFrames - 1) {
          onProgress?.({
            percentage: Math.floor(10 + ((f + 1) / totalFrames) * 85),
            statusText: `映像をエンコード中 (${Math.floor(t)}秒 / ${Math.floor(duration)}秒)...`,
          });
          await yieldToBrowser();
        }
      }
      while (mixer && soundBlocks < mixer.blockCount) await encodeNextSoundBlock();

      checkCanceled();
      onProgress?.({ percentage: 97, statusText: 'ファイルを仕上げ中...' });
      fileStream?.keep();
      await output.finalize();
    } catch (e) {
      if (output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch(() => {});
      }
      throw e;
    } finally {
      await frames.dispose();
    }

    let blob: Blob | null = null;
    if (target instanceof BufferTarget) {
      if (!target.buffer) throw new Error('書き出したファイルの取得に失敗しました。');
      blob = new Blob([target.buffer], { type: chosen.mimeType });
    }

    const isMp4 = chosen.fileExtension === 'mp4';
    const videoLabel = isMp4 ? 'H.264' : chosen.videoCodec.toUpperCase();
    const audioLabel = audioSource ? (isMp4 ? ' / AAC' : ' / Opus') : '';
    onProgress?.({ percentage: 100, statusText: '書き出し完了！' });
    return {
      blob,
      fileExtension: chosen.fileExtension,
      formatLabel: `${isMp4 ? 'MP4' : 'WebM'} (${videoLabel}${audioLabel})`,
      warnings,
      soundtrack: audioSource && mastering ? mastering.levels() : null,
    };
  } finally {
    mixer?.dispose();
    releaseUnusedFile();
  }
}
