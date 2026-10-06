/**
 * Video Exporter Service
 * Renders the timeline frame by frame (faster than real time, unaffected by background tabs)
 * and encodes it with WebCodecs into an MP4 (H.264 + AAC), or WebM (VP9/VP8 + Opus) where the
 * browser cannot encode H.264/AAC. Video clips are decoded frame-accurately, and the soundtrack
 * is a complete offline mixdown (narration, BGM with auto-ducking, ambience, video clip sound, fades).
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
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type OutputFormat,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import { ProjectData, SupportedLanguage, VideoClipItem } from '../types';
import { canvasRenderer, ExportRenderOptions } from './canvasRenderer';

export interface ExportProgress {
  percentage: number;
  statusText: string;
}

export interface ExportResult {
  blob: Blob;
  fileExtension: 'mp4' | 'webm';
  formatLabel: string;
  /** Problems that did not stop the export (e.g. a clip that could not be decoded) */
  warnings: string[];
}

export class ExportCanceledError extends Error {
  constructor() {
    super('書き出しを中止しました。');
  }
}

const FPS = 30;
const SAMPLE_RATE = 48000;
const VIDEO_BITRATE = 8_000_000; // YouTube's recommendation for 1080p30 SDR uploads

interface ChosenFormat {
  format: OutputFormat;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  fileExtension: 'mp4' | 'webm';
  mimeType: string;
  formatLabel: string;
}

async function chooseFormat(width: number, height: number, needsAudio: boolean): Promise<ChosenFormat> {
  const audioOptions = { numberOfChannels: 2, sampleRate: SAMPLE_RATE };

  const avc = await getFirstEncodableVideoCodec(['avc'], { width, height, bitrate: VIDEO_BITRATE });
  const aac = needsAudio ? await getFirstEncodableAudioCodec(['aac'], audioOptions) : null;
  if (avc && (aac || !needsAudio)) {
    return {
      format: new Mp4OutputFormat({ fastStart: false }), // metadata at the end keeps memory use to one copy
      videoCodec: avc,
      audioCodec: aac,
      fileExtension: 'mp4',
      mimeType: 'video/mp4',
      formatLabel: needsAudio ? 'MP4 (H.264 / AAC)' : 'MP4 (H.264)',
    };
  }

  const vp = await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width, height, bitrate: VIDEO_BITRATE });
  const opus = needsAudio ? await getFirstEncodableAudioCodec(['opus'], audioOptions) : null;
  if (vp && (opus || !needsAudio)) {
    return {
      format: new WebMOutputFormat(),
      videoCodec: vp,
      audioCodec: opus,
      fileExtension: 'webm',
      mimeType: 'video/webm',
      formatLabel: `WebM (${vp.toUpperCase()}${needsAudio ? ' / Opus' : ''})`,
    };
  }

  throw new Error('このブラウザは動画の書き出し（エンコード）に対応していません。最新版のChromeまたはEdgeでお試しください。');
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

/** Merge narration spans whose gap is too short for the BGM to come back up in between */
function mergeIntervals(intervals: [number, number][], minGap: number): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] < minGap) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

function scheduleSource(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  destination: AudioNode,
  start: number,
  end: number,
  offset: number,
  loop: boolean
) {
  const sourceOffset = loop ? offset % buffer.duration : offset;
  if (sourceOffset >= buffer.duration) return; // trimmed past the end of the file
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.connect(destination);
  source.start(start, sourceOffset, end - start);
}

/**
 * Mix every audible track into one stereo buffer. Mirrors the preview: muted tracks and
 * tracks without a sound file are silent.
 */
async function renderAudioMix(project: ProjectData, duration: number, warnings: string[]): Promise<AudioBuffer | null> {
  const muted = project.mutedTracks || {};
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE);
  let hasSound = false;

  const narrationSpans: [number, number][] = muted.narration
    ? []
    : project.audioTracks
        .filter((t) => t.type === 'narration' && t.dataUrl)
        .map((t): [number, number] => [t.startTime, Math.min(duration, t.startTime + t.duration)]);

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
      const duckLevel = track.autoDucking?.duckVolume ?? 0.22;
      const ramp = track.autoDucking?.fadeSec ?? 0.35;
      const duck = ctx.createGain();
      duck.gain.setValueAtTime(1, 0);
      for (const [s, e] of mergeIntervals(narrationSpans, ramp * 2)) {
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

  // Original sound recorded with the video clips
  if (!muted.video) {
    for (const clip of project.videoClips) {
      const volume = Math.max(0, Math.min(1, clip.volume ?? 1));
      if (clip.type !== 'video' || !clip.dataUrl || volume === 0) continue;
      const start = Math.max(0, clip.startTime);
      const end = Math.min(duration, clip.startTime + clip.duration);
      if (end <= start) continue;

      const buffer = await decodeAudio(ctx, clip.dataUrl);
      if (!buffer) continue; // a video without a sound track is normal

      const fade = createFadeGain(ctx, start, end, volume, 0.05, 0.1);
      fade.connect(ctx.destination);
      scheduleSource(ctx, buffer, fade, start, end, Math.max(0, clip.trimStart || 0), false);
      hasSound = true;
    }
  }

  return hasSound ? await ctx.startRendering() : null;
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

  async frameFor(clip: VideoClipItem): Promise<ExportRenderOptions['videoFrame']> {
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
    '⛩️📍【】御祭神ご利益所在地最寄り駅駐車場参拝時間アクセス案内作法心得神域の静寂 - Sanctuary Stillness',
    'DeityBlessingEnshrinedAddressTransitParkingHours0123456789°NE.,:-',
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
  exportLang: SupportedLanguage = 'ja',
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal
): Promise<ExportResult> {
  const isLandscape = project.aspectRatio === '16:9';
  const width = isLandscape ? 1920 : 1080;
  const height = isLandscape ? 1080 : 1920;
  const duration = Math.max(1, project.duration);
  const totalFrames = Math.ceil(duration * FPS);
  const warnings: string[] = [];
  const checkCanceled = () => {
    if (signal?.aborted) throw new ExportCanceledError();
  };

  // 1. Fonts and images, so the first frames are not drawn with fallbacks
  onProgress?.({ percentage: 2, statusText: 'フォントと素材を準備中...' });
  await loadFonts(project, exportLang);
  for (const clip of project.videoClips) {
    if (clip.type === 'image' && clip.dataUrl) {
      await canvasRenderer.preloadImage(clip.dataUrl).catch(() => {
        warnings.push(`写真「${clip.name}」を読み込めなかったため、背景のみで書き出しました。`);
      });
    }
  }
  checkCanceled();

  // 2. Soundtrack
  onProgress?.({ percentage: 5, statusText: '音声をミックス中（ダッキング・フェードを反映）...' });
  const mixedAudio = await renderAudioMix(project, duration, warnings);
  checkCanceled();

  // 3. Encoder setup
  const chosen = await chooseFormat(width, height, mixedAudio !== null);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const output = new Output({ format: chosen.format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: chosen.videoCodec, bitrate: VIDEO_BITRATE });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  let audioSource: AudioBufferSource | null = null;
  if (mixedAudio && chosen.audioCodec) {
    audioSource = new AudioBufferSource({ codec: chosen.audioCodec, bitrate: QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }

  // Which source timestamps each video clip will be asked for, in frame order
  const plan = new Map<string, number[]>();
  for (let f = 0; f < totalFrames; f++) {
    const t = f / FPS;
    const clip = canvasRenderer.getActiveClip(project, t);
    if (clip?.type === 'video') {
      if (!plan.has(clip.id)) plan.set(clip.id, []);
      plan.get(clip.id)!.push(Math.max(0, clip.trimStart + (t - clip.startTime)));
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
      const t = f / FPS;
      const clip = canvasRenderer.getActiveClip(project, t);
      const videoFrame = clip?.type === 'video' ? await frames.frameFor(clip) : null;

      canvasRenderer.renderFrame(ctx, project, t, exportLang, false, { videoFrame });
      await videoSource.add(t, 1 / FPS);

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
    await output.finalize();
  } catch (e) {
    if (output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    throw e;
  } finally {
    await frames.dispose();
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) {
    throw new Error('書き出したファイルの取得に失敗しました。');
  }

  onProgress?.({ percentage: 100, statusText: '書き出し完了！' });
  return {
    blob: new Blob([buffer], { type: chosen.mimeType }),
    fileExtension: chosen.fileExtension,
    formatLabel: chosen.formatLabel,
    warnings,
  };
}
