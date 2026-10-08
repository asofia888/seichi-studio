/**
 * Video analysis for automatic editing, done entirely in the browser (nothing is uploaded):
 * when and where each video was recorded, where someone is talking, and which moments
 * are steady, sharp and well exposed enough to show.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny';

export interface VideoAnalysis {
  file: File;
  /** File name without the extension */
  name: string;
  duration: number;
  /** From the file's metadata; null when the camera did not record it */
  recordedAt: Date | null;
  location: { lat: number; lng: number } | null;
  /** Source-file seconds where someone is talking */
  speechRanges: [number, number][];
  /** Picture quality from 0 to 1 every QUALITY_STEP seconds; null when the picture could not be decoded */
  quality: number[] | null;
  /** Problems that did not stop the analysis */
  warnings: string[];
}

export const QUALITY_STEP = 0.25;

// ---------------------------------------------------------------------------
// Recording date and place
// ---------------------------------------------------------------------------

const MP4_EPOCH_OFFSET_SEC = 2082844800; // 1904-01-01 (MP4 epoch) to 1970-01-01

function isPlausibleRecordingDate(date: Date): boolean {
  const t = date.getTime();
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) && t < Date.now() + 86_400_000;
}

/** ISO 6709 point such as "+35.6895+139.6917+040.000/" (iPhone, and Android's ©xyz) */
function parseIso6709(value: string): { lat: number; lng: number } | null {
  const m = value.match(/([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

async function findMp4Box(file: File, start: number, end: number, type: string) {
  let pos = start;
  while (pos + 8 <= end) {
    const header = new DataView(await file.slice(pos, Math.min(end, pos + 16)).arrayBuffer());
    if (header.byteLength < 8) return null;
    let size = header.getUint32(0);
    const name = String.fromCharCode(header.getUint8(4), header.getUint8(5), header.getUint8(6), header.getUint8(7));
    let headerSize = 8;
    if (size === 1) {
      if (header.byteLength < 16) return null;
      size = Number(header.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos; // the box runs to the end of its parent
    }
    if (size < headerSize) return null;
    if (name === type) return { contentStart: pos + headerSize, end: Math.min(end, pos + size) };
    pos += size;
  }
  return null;
}

/** Creation time in the MP4/MOV movie header (most Android phones and cameras put the recording time here) */
async function readMp4CreationTime(file: File): Promise<Date | null> {
  try {
    const moov = await findMp4Box(file, 0, file.size, 'moov');
    const mvhd = moov && (await findMp4Box(file, moov.contentStart, moov.end, 'mvhd'));
    if (!mvhd) return null;
    const view = new DataView(await file.slice(mvhd.contentStart, mvhd.contentStart + 12).arrayBuffer());
    const seconds = view.getUint8(0) === 1 ? Number(view.getBigUint64(4)) : view.getUint32(4);
    const date = new Date((seconds - MP4_EPOCH_OFFSET_SEC) * 1000);
    return isPlausibleRecordingDate(date) ? date : null;
  } catch {
    return null;
  }
}

async function readRecordingInfo(input: Input, file: File) {
  let tagDate: Date | null = null;
  let location: { lat: number; lng: number } | null = null;
  try {
    const tags = await input.getMetadataTags();
    if (tags.date && isPlausibleRecordingDate(tags.date)) tagDate = tags.date;
    for (const [key, value] of Object.entries(tags.raw ?? {})) {
      if (typeof value === 'string' && /xyz|location/i.test(key)) {
        location ??= parseIso6709(value);
      }
    }
  } catch {}
  // A tagged date at exactly midnight UTC is a date without a time ("2026-10-01"), which cannot
  // order videos of the same day; the movie header's creation time then gives the time of day
  const isDateOnly = tagDate !== null && tagDate.getTime() % 86_400_000 === 0;
  const recordedAt = (isDateOnly ? await readMp4CreationTime(file) : null) ?? tagDate ?? (await readMp4CreationTime(file));
  return { recordedAt, location };
}

// ---------------------------------------------------------------------------
// Talking detection
// ---------------------------------------------------------------------------

// Analysis runs on a band-limited copy at about 8 kHz: enough for the voice, cheap enough for long videos
const VOICE_RATE = 8000;
const VOICE_FRAME_SEC = 0.05;

/** Second-order filter (RBJ cookbook) with its own state, so it can run across consecutive buffers */
function createBiquad(kind: 'lowpass' | 'highpass', freq: number, sampleRate: number) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (kind === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  const b1 = (kind === 'lowpass' ? 1 - cos : -(1 + cos)) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let z1 = 0;
  let z2 = 0;
  return (x: number) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

/** Strongest normalized autocorrelation over voice pitch periods (85-400 Hz): near 1 for a voice, low for noise */
function voicing(frame: Float32Array, rate: number): number {
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.min(frame.length - 1, Math.ceil(rate / 85));
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let n = 0; n + lag < frame.length; n++) {
      const a = frame[n];
      const b = frame[n + lag];
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    if (xx > 0 && yy > 0) best = Math.max(best, xy / Math.sqrt(xx * yy));
  }
  return best;
}

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/**
 * Where someone is talking. A frame counts as voice when it is clearly louder than the clip's
 * background (wind, water, crowds) and has a pitch (gravel footsteps and wind do not).
 * Voiced frames are then grouped into utterances with natural pauses inside them.
 */
async function detectSpeech(
  track: InputAudioTrack,
  duration: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<[number, number][]> {
  const sink = new AudioBufferSink(track);
  const firstTimestamp = await track.getFirstTimestamp();

  const levels: number[] = []; // dB per frame
  const voiced: number[] = []; // voicing per frame
  let filters: ((x: number) => number)[] | null = null;
  let decimation = 1;
  let frame: Float32Array = new Float32Array(0);
  let framePos = 0;
  let phase = 0;
  let startOffset: number | null = null;

  for await (const { buffer, timestamp } of sink.buffers()) {
    signal?.throwIfAborted();
    if (!filters) {
      decimation = Math.max(1, Math.round(buffer.sampleRate / VOICE_RATE));
      const rate = buffer.sampleRate;
      // Below 150 Hz is mostly wind and handling noise; the low-pass also prevents aliasing when decimating
      filters = [
        createBiquad('highpass', 150, rate),
        createBiquad('lowpass', 3400, rate),
        createBiquad('lowpass', 3400, rate),
      ];
      frame = new Float32Array(Math.round((rate / decimation) * VOICE_FRAME_SEC));
      startOffset = Math.max(0, timestamp - firstTimestamp);
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    for (let i = 0; i < buffer.length; i++) {
      let x = 0;
      for (const ch of channels) x += ch[i];
      x /= channels.length;
      for (const f of filters) x = f(x);
      if (++phase < decimation) continue;
      phase = 0;
      frame[framePos++] = x;
      if (framePos === frame.length) {
        let energy = 0;
        for (let n = 0; n < frame.length; n++) energy += frame[n] * frame[n];
        levels.push(10 * Math.log10(energy / frame.length + 1e-12));
        voiced.push(voicing(frame, buffer.sampleRate / decimation));
        framePos = 0;
      }
    }
    if (duration > 0) onProgress(Math.min(1, (timestamp - firstTimestamp + buffer.duration) / duration));
  }
  if (levels.length === 0) return [];

  const background = percentile(levels, 0.1);
  const threshold = Math.max(background + 12, -50);
  const active = levels.map((db, i) => db > threshold && voiced[i] > 0.5);

  // Voiced runs -> utterances: pauses up to 1.2 s stay inside one utterance
  const maxPause = Math.round(1.2 / VOICE_FRAME_SEC);
  const utterances: { start: number; end: number; voicedFrames: number }[] = [];
  for (let i = 0; i < active.length; i++) {
    if (!active[i]) continue;
    const last = utterances[utterances.length - 1];
    if (last && i - last.end <= maxPause) {
      last.end = i + 1;
      last.voicedFrames++;
    } else {
      utterances.push({ start: i, end: i + 1, voicedFrames: 1 });
    }
  }

  const offset = startOffset ?? 0;
  const ranges: [number, number][] = [];
  for (const u of utterances) {
    const frames = u.end - u.start;
    // Long enough to be words, and dense enough to be talking rather than a few stray sounds
    if (frames * VOICE_FRAME_SEC < 0.8 || u.voicedFrames < 6 || u.voicedFrames / frames < 0.25) continue;
    const start = Math.max(0, offset + u.start * VOICE_FRAME_SEC - 0.3);
    const end = Math.min(duration, offset + u.end * VOICE_FRAME_SEC + 0.5);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges.map(([s, e]) => [Math.round(s * 100) / 100, Math.round(e * 100) / 100]);
}

// ---------------------------------------------------------------------------
// Picture quality
// ---------------------------------------------------------------------------

// Frames are copied onto this CPU-side canvas before reading pixels, which is much cheaper
// than reading back from the decoder's GPU canvases every time
let readbackCtx: OffscreenCanvasRenderingContext2D | null = null;

function readLuma(canvas: HTMLCanvasElement | OffscreenCanvas): { luma: Float32Array; width: number; height: number } {
  const { width, height } = canvas;
  if (!readbackCtx || readbackCtx.canvas.width !== width || readbackCtx.canvas.height !== height) {
    readbackCtx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  }
  readbackCtx.drawImage(canvas, 0, 0);
  const rgba = readbackCtx.getImageData(0, 0, width, height).data;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return { luma, width, height };
}

/**
 * Quality of the picture every QUALITY_STEP seconds: steady (little change from the previous
 * sample, so no walking shake or whip pans), sharp (not motion-blurred or out of focus), and
 * neither too dark nor blown out. Frames are decoded at a tiny size, which keeps this fast.
 */
async function measurePictureQuality(
  track: InputVideoTrack,
  duration: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<number[]> {
  const firstTimestamp = await track.getFirstTimestamp();
  const isLandscape = track.displayWidth >= track.displayHeight;
  const sink = new CanvasSink(track, isLandscape ? { width: 96, poolSize: 2 } : { height: 96, poolSize: 2 });
  const count = Math.max(1, Math.floor(duration / QUALITY_STEP));
  const timestamps = Array.from({ length: count }, (_, i) => firstTimestamp + i * QUALITY_STEP);

  const motion: number[] = [];
  const sharpness: number[] = [];
  const brightness: number[] = [];
  let previous: Float32Array | null = null;
  let i = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    signal?.throwIfAborted();
    if (wrapped) {
      const { luma, width, height } = readLuma(wrapped.canvas);
      let diff = 0;
      let gradient = 0;
      let sum = 0;
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
          const p = y * width + x;
          gradient += Math.abs(luma[p + 1] - luma[p]) + Math.abs(luma[p + width] - luma[p]);
        }
      }
      for (let p = 0; p < luma.length; p++) {
        sum += luma[p];
        if (previous && previous.length === luma.length) diff += Math.abs(luma[p] - previous[p]);
      }
      motion.push(previous && previous.length === luma.length ? diff / luma.length : NaN);
      sharpness.push(gradient / ((width - 1) * (height - 1)));
      brightness.push(sum / luma.length);
      previous = luma;
    } else {
      motion.push(NaN);
      sharpness.push(0);
      brightness.push(0);
    }
    if (++i % 8 === 0) onProgress(i / count);
  }

  // The first sample has nothing to compare with; it borrows the next one's movement
  for (let k = 0; k < motion.length; k++) {
    if (Number.isNaN(motion[k])) motion[k] = Number.isNaN(motion[k + 1]) || k + 1 >= motion.length ? 0 : motion[k + 1];
  }
  // Sharpness depends on the scene, so it is judged against this clip's sharpest moments
  const sharpReference = Math.max(1e-6, percentile(sharpness, 0.9));
  return motion.map((m, k) => {
    const steadiness = 1 / (1 + (m / 8) ** 2);
    const sharp = Math.min(1, sharpness[k] / sharpReference);
    const b = brightness[k];
    const exposure = b < 20 ? 0.1 : b < 40 ? 0.5 : b > 235 ? 0.5 : 1;
    return Math.round(steadiness * (0.4 + 0.6 * sharp) * exposure * 1000) / 1000;
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Analyze one video. Throws (with a message for the user) only when the file cannot be read
 * at all; a sound track or picture the browser cannot decode becomes a warning instead.
 */
export async function analyzeVideo(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<VideoAnalysis> {
  const name = file.name.replace(/\.[^/.]+$/, '');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let duration: number;
    try {
      duration = await input.computeDuration();
    } catch {
      throw new Error(`「${file.name}」は読み込めない形式のため、使いませんでした。`);
    }
    if (!(duration > 0.5)) throw new Error(`「${file.name}」は短すぎるか空のため、使いませんでした。`);

    const { recordedAt, location } = await readRecordingInfo(input, file);
    const warnings: string[] = [];
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!videoTrack) throw new Error(`「${file.name}」には映像が入っていないため、使いませんでした。`);

    // Sound and picture are read side by side; the overall progress follows the slower of the two
    let audioDone = audioTrack ? 0 : 1;
    let videoDone = 0;
    const report = () => onProgress(Math.min(audioDone, videoDone));

    const speechTask = (async () => {
      if (!audioTrack) return [];
      if (!(await audioTrack.canDecode())) {
        warnings.push(`「${name}」の音声はこのブラウザで解析できないため、話し声の検出を省きました。`);
        return [];
      }
      try {
        return await detectSpeech(audioTrack, duration, (f) => ((audioDone = f), report()), signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        warnings.push(`「${name}」の音声を解析できなかったため、話し声の検出を省きました。`);
        return [];
      } finally {
        audioDone = 1;
      }
    })();

    const qualityTask = (async () => {
      if (!(await videoTrack.canDecode())) {
        warnings.push(`「${name}」の映像はこのブラウザで解析できない形式のため、見どころを選ばずに使いました（プレビュー・書き出しにも映らない可能性があります）。`);
        return null;
      }
      try {
        return await measurePictureQuality(videoTrack, duration, (f) => ((videoDone = f), report()), signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        warnings.push(`「${name}」の映像を解析できなかったため、見どころを選ばずに使いました。`);
        return null;
      } finally {
        videoDone = 1;
      }
    })();

    const [speechRanges, quality] = await Promise.all([speechTask, qualityTask]);
    report();
    return { file, name, duration, recordedAt, location, speechRanges, quality, warnings };
  } finally {
    input.dispose();
  }
}

/** One frame as a JPEG (base64, no data: prefix) with its longer side at `maxSize`, for Claude to look at */
export async function captureFrameJpeg(file: File, time: number, maxSize = 640): Promise<string | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const isLandscape = track.displayWidth >= track.displayHeight;
    const sink = new CanvasSink(track, isLandscape ? { width: maxSize } : { height: maxSize });
    const wrapped = await sink.getCanvas((await track.getFirstTimestamp()) + time);
    if (!wrapped) return null;
    const canvas = wrapped.canvas;
    const blob =
      canvas instanceof HTMLCanvasElement
        ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
        : await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
