/**
 * Video Exporter Service
 * Renders the timeline frame by frame (faster than real time, unaffected by background tabs)
 * and encodes it with WebCodecs into an MP4 (H.264 + AAC), or WebM (VP9/VP8 + Opus) where the
 * browser cannot encode H.264/AAC, at 1080p or 4K and 24/30/60 fps. Video clips are decoded
 * frame-accurately, and the soundtrack is a complete offline mixdown (narration, BGM with
 * auto-ducking, ambience, video clip sound, fades), brought to the target loudness with its peaks
 * limited. The file is kept in memory, or written straight to a file the user picked (long videos).
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
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
import { clipSoundSpan, clipSpeed, pictureAt, pictureLayers } from './composition';
import { DEFAULT_DUCK_RAMP_SEC, DEFAULT_DUCK_VOLUME, getSpeechSpans, measureBufferLoudness, mergeSpans } from './audioEngine';
import { applyGainWithLimiter, dbToGain, MAX_BOOST_DB, peakDb } from './mastering';

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

const SAMPLE_RATE = 48000;

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
// Audio mixdown
// ---------------------------------------------------------------------------

async function decodeAudio(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch {
    return null;
  }
}

/**
 * The sound of a video file between source seconds `from` and `to`, decoded on its own: a long
 * video is never decoded whole, and a clip cut into many pieces decodes only those pieces.
 * `start` is the source second the buffer begins at. Null when the file has no sound track.
 */
async function decodeVideoSound(url: string, from: number, to: number): Promise<{ buffer: AudioBuffer; start: number } | null> {
  let input: Input | null = null;
  try {
    const blob = await (await fetch(url)).blob();
    input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const first = await track.getFirstTimestamp();

    const pieces: AudioBuffer[] = [];
    let start: number | null = null;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(first + from, first + to)) {
      start ??= timestamp - first;
      pieces.push(buffer);
    }
    if (pieces.length === 0 || start === null) return null;

    const channels = Math.max(...pieces.map((p) => p.numberOfChannels));
    const joined = new AudioBuffer({
      length: pieces.reduce((n, p) => n + p.length, 0),
      numberOfChannels: channels,
      sampleRate: pieces[0].sampleRate,
    });
    let position = 0;
    for (const piece of pieces) {
      for (let c = 0; c < channels; c++) {
        joined.copyToChannel(piece.getChannelData(Math.min(c, piece.numberOfChannels - 1)), c, position);
      }
      position += piece.length;
    }
    return { buffer: joined, start };
  } catch {
    return null; // a video without a sound track (or one this browser cannot decode) is played silent
  } finally {
    input?.dispose();
  }
}

/** Gain node that fades in at `start` and out at `end`, at the given volume */
function createFadeGain(
  ctx: BaseAudioContext,
  start: number,
  end: number,
  volume: number,
  fadeIn: number,
  fadeOut: number
): GainNode {
  const gain = ctx.createGain();
  const fadeInEnd = Math.min(end, start + Math.max(0, fadeIn));
  gain.gain.setValueAtTime(fadeIn > 0 ? 0 : volume, start);
  if (fadeIn > 0) {
    gain.gain.linearRampToValueAtTime(volume, fadeInEnd);
  }
  if (fadeOut > 0) {
    // Never start fading out before the fade-in has finished
    gain.gain.setValueAtTime(volume, Math.max(fadeInEnd, end - fadeOut));
    gain.gain.linearRampToValueAtTime(0, end);
  }
  return gain;
}

/** Play `buffer` from `offset` (seconds into it) over timeline seconds start to end, at `speed` */
function scheduleSource(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  start: number,
  end: number,
  offset: number,
  loop: boolean,
  speed = 1
) {
  const sourceOffset = loop ? offset % buffer.duration : offset;
  if (sourceOffset >= buffer.duration || end <= start) return; // trimmed past the end of the file
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.playbackRate.value = speed;
  source.connect(destination);
  // The length to play is measured in the buffer's own seconds
  source.start(start, sourceOffset, (end - start) * speed);
}

/**
 * Mix every audible track into one stereo buffer. Mirrors the preview: muted tracks and
 * tracks without a sound file are silent.
 */
async function renderAudioMix(project: ProjectData, duration: number, warnings: string[]): Promise<AudioBuffer | null> {
  const muted = project.mutedTracks || {};
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE);
  let hasSound = false;

  // Narrations and talking in video clips: the BGM ducks under both
  const narrationSpans = getSpeechSpans(project.audioTracks, project.videoClips, muted)
    .map(([s, e]): [number, number] => [s, Math.min(duration, e)])
    .filter(([s, e]) => e > s);

  for (const track of project.audioTracks) {
    if (muted[track.type] || !track.dataUrl) continue;
    const start = Math.max(0, track.startTime);
    const end = Math.min(duration, track.startTime + track.duration);
    if (end <= start) continue;

    const buffer = await decodeAudio(ctx, track.dataUrl);
    if (!buffer) {
      warnings.push(`音声「${track.name}」を読み込めなかったため、無音で書き出しました。`);
      continue;
    }

    const isLooped = track.type === 'bgm' || track.type === 'ambience';
    const fadeIn = track.fadeInSec ?? (isLooped ? 1.5 : 0.05);
    const fadeOut = track.fadeOutSec ?? (isLooped ? 2.0 : 0.1);
    const fade = createFadeGain(ctx, start, end, Math.max(0, Math.min(1, track.volume)), fadeIn, fadeOut);
    fade.connect(ctx.destination);

    let input: AudioNode = fade;
    if (track.type === 'bgm' && track.autoDucking?.enabled !== false && narrationSpans.length > 0) {
      // Ducking runs on its own gain node so its automation never collides with the fades
      // The same curve the preview follows (duckGainAt)
      const duckLevel = track.autoDucking?.duckVolume ?? DEFAULT_DUCK_VOLUME;
      const ramp = track.autoDucking?.fadeSec ?? DEFAULT_DUCK_RAMP_SEC;
      const duck = ctx.createGain();
      duck.gain.setValueAtTime(1, 0);
      for (const [s, e] of mergeSpans(narrationSpans, ramp * 2)) {
        duck.gain.setValueAtTime(1, Math.max(0, s - ramp));
        duck.gain.linearRampToValueAtTime(duckLevel, Math.max(0, s));
        duck.gain.setValueAtTime(duckLevel, e);
        duck.gain.linearRampToValueAtTime(1, e + ramp);
      }
      duck.connect(fade);
      input = duck;
    }

    scheduleSource(ctx, buffer, input, start, end, Math.max(0, track.trimStart || 0), isLooped);
    hasSound = true;
  }

  // Original sound recorded with the video clips (crossfaded at dissolves, sped up or slowed down with the picture)
  if (!muted.video) {
    for (const clip of project.videoClips) {
      const volume = Math.max(0, Math.min(1, clip.volume ?? 1));
      if (clip.type !== 'video' || !clip.dataUrl || volume === 0) continue;
      const span = clipSoundSpan(project, clip);
      const start = Math.max(0, span.start);
      const end = Math.min(duration, span.end);
      if (end <= start) continue;

      const speed = clipSpeed(clip);
      const from = span.sourceOffset + (start - span.start) * speed;
      const sound = await decodeVideoSound(clip.dataUrl, from, from + (end - start) * speed);
      if (!sound) continue; // a video without a sound track is normal

      const fade = createFadeGain(ctx, start, end, volume, span.fadeIn, span.fadeOut);
      fade.connect(ctx.destination);
      // The decoded sound may begin a moment after `from` (where the file's first sound packet is)
      const lateBy = Math.max(0, sound.start - from) / speed;
      scheduleSource(ctx, sound.buffer, fade, start + lateBy, end, Math.max(0, from - sound.start), false, speed);
      hasSound = true;
    }
  }

  return hasSound ? await ctx.startRendering() : null;
}

// Close enough to the target loudness; YouTube's own measurement varies by about this much
const LOUDNESS_TOLERANCE_LU = 0.5;

/**
 * Bring the mix to `targetLufs` with one gain for the whole soundtrack (raising it by at most
 * MAX_BOOST_DB), and keep every peak under the limiter's ceiling. Limiting the loudest moments
 * takes a little loudness off, so the gain is topped up once more if it fell short. In place.
 */
async function masterSoundtrack(mix: AudioBuffer, targetLufs: number | null): Promise<SoundtrackLevels> {
  const channels = Array.from({ length: mix.numberOfChannels }, (_, c) => mix.getChannelData(c));
  let lufs = await measureBufferLoudness(mix);
  let gainDb = 0;

  if (targetLufs !== null && lufs !== null) {
    gainDb = Math.min(MAX_BOOST_DB, targetLufs - lufs);
    applyGainWithLimiter(channels, mix.sampleRate, dbToGain(gainDb));
    lufs = await measureBufferLoudness(mix);
    if (lufs !== null && lufs < targetLufs - LOUDNESS_TOLERANCE_LU && gainDb < MAX_BOOST_DB) {
      const more = Math.min(MAX_BOOST_DB - gainDb, targetLufs - lufs);
      applyGainWithLimiter(channels, mix.sampleRate, dbToGain(more));
      gainDb += more;
      lufs = await measureBufferLoudness(mix);
    }
  } else {
    applyGainWithLimiter(channels, mix.sampleRate, 1);
  }

  return { lufs, gainDb: Math.round(gainDb * 10) / 10, peakDb: Math.round(peakDb(channels) * 10) / 10 };
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

    // 2. Soundtrack
    onProgress?.({ percentage: 5, statusText: '音声をミックス中（ダッキング・フェードを反映）...' });
    const mixedAudio = await renderAudioMix(project, duration, warnings);
    checkCanceled();
    let soundtrack: SoundtrackLevels | null = null;
    if (mixedAudio) {
      onProgress?.({
        percentage: 7,
        statusText: targetLufs === null ? '音割れを防ぐ処理中...' : `音量を ${targetLufs} LUFS にそろえています...`,
      });
      soundtrack = await masterSoundtrack(mixedAudio, targetLufs);
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
    if (mixedAudio && chosen.audioCodec) {
      audioSource = new AudioBufferSource({ codec: chosen.audioCodec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }

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

      if (audioSource && mixedAudio) {
        onProgress?.({ percentage: 8, statusText: '音声をエンコード中...' });
        await audioSource.add(mixedAudio);
        audioSource.close();
      }

      // 4. Frames, rendered at exact timestamps (no real-time pacing, so audio and video cannot drift)
      for (let f = 0; f < totalFrames; f++) {
        checkCanceled();
        const t = f / fps;
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
      soundtrack,
    };
  } finally {
    releaseUnusedFile();
  }
}
