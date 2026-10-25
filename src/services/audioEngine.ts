/**
 * Web Audio Engine for Sacred Sanctuary Studio
 * Supports multi-track playback (Narration, Ambience, BGM), automatic BGM ducking,
 * microphone recording, a real output level meter, and loudness measurement (LUFS).
 */
import { AudioTrackItem, ProjectData, VideoClipItem } from '../types';
import { clipSpeed } from './composition';

/**
 * Timeline spans where someone is heard speaking: narrations with a sound file, and talking
 * detected in the original sound of video clips. The BGM ducks under these.
 */
export function getSpeechSpans(
  audioTracks: AudioTrackItem[],
  videoClips: VideoClipItem[],
  mutedTracks?: ProjectData['mutedTracks']
): [number, number][] {
  const spans: [number, number][] = [];
  if (!mutedTracks?.narration) {
    for (const t of audioTracks) {
      if (t.type === 'narration' && t.dataUrl) spans.push([t.startTime, t.startTime + t.duration]);
    }
  }
  if (!mutedTracks?.video) {
    for (const clip of videoClips) {
      if (clip.type !== 'video' || !clip.dataUrl || (clip.volume ?? 1) === 0) continue;
      const clipEnd = clip.startTime + clip.duration;
      const speed = clipSpeed(clip);
      // speechRanges are in source-file seconds; map them onto the timeline and keep the part inside the clip
      for (const [s, e] of clip.speechRanges || []) {
        const start = Math.max(clip.startTime, clip.startTime + (s - clip.trimStart) / speed);
        const end = Math.min(clipEnd, clip.startTime + (e - clip.trimStart) / speed);
        if (end > start) spans.push([start, end]);
      }
    }
  }
  return spans;
}

// How far and how quickly the BGM is turned down under speech, unless the track says otherwise
export const DEFAULT_DUCK_VOLUME = 0.22;
export const DEFAULT_DUCK_RAMP_SEC = 0.35;

/** Merge speech spans whose gap is too short for the BGM to come back up in between */
export function mergeSpans(intervals: [number, number][], minGap: number): [number, number][] {
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

/**
 * How much the BGM is turned down at `t` under the (merged) speech spans: 1 is not at all,
 * `duckLevel` is fully. It ramps down over `rampSec` before each span and back up over `rampSec`
 * after it, the same curve the export writes, so the preview sounds like the finished video.
 */
export function duckGainAt(spans: [number, number][], t: number, duckLevel: number, rampSec: number): number {
  let gain = 1;
  for (const [s, e] of spans) {
    const downFrom = Math.max(0, s - rampSec);
    let g = 1;
    if (t >= s && t <= e) {
      g = duckLevel;
    } else if (t >= downFrom && t < s) {
      g = 1 - (1 - duckLevel) * ((t - downFrom) / (s - downFrom));
    } else if (t > e && t < e + rampSec) {
      g = duckLevel + (1 - duckLevel) * ((t - e) / rampSec);
    }
    gain = Math.min(gain, g);
  }
  return gain;
}

/** Whether someone is heard speaking at `time` (a narration, or talking in a video clip) */
export function isNarrationAudibleAt(
  audioTracks: AudioTrackItem[],
  videoClips: VideoClipItem[],
  time: number,
  mutedTracks?: ProjectData['mutedTracks']
): boolean {
  return getSpeechSpans(audioTracks, videoClips, mutedTracks).some(([s, e]) => time >= s && time < e);
}

// The rate the standard's K-weighting coefficients are published for
const LOUDNESS_SAMPLE_RATE = 48000;

/** Integrated loudness of a sound file (see measureBufferLoudness) */
async function measureIntegratedLoudness(url: string): Promise<number | null> {
  const data = await (await fetch(url)).arrayBuffer();
  // decodeAudioData resamples to the context's rate, so the audio is always 48 kHz here
  const buffer = await new OfflineAudioContext(1, 1, LOUDNESS_SAMPLE_RATE).decodeAudioData(data);
  return measureBufferLoudness(buffer);
}

/**
 * Integrated loudness in LUFS per ITU-R BS.1770 / EBU R128: K-weighting, 400 ms blocks with
 * 75% overlap, absolute gate at -70 LUFS and relative gate at -10 LU. `buffer` must be 48 kHz.
 * Null when it is silent (or shorter than 0.4 s).
 */
export async function measureBufferLoudness(buffer: AudioBuffer): Promise<number | null> {
  if (buffer.sampleRate !== LOUDNESS_SAMPLE_RATE) {
    throw new Error(`Loudness can only be measured at ${LOUDNESS_SAMPLE_RATE} Hz, not ${buffer.sampleRate} Hz`);
  }
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, LOUDNESS_SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // K-weighting, BS.1770-4 Table 1 (pre-filter) and Table 2 (RLB high-pass) at 48 kHz
  const preFilter = ctx.createIIRFilter(
    [1.53512485958697, -2.69169618940638, 1.19839281085285],
    [1.0, -1.69065929318241, 0.73248077421585]
  );
  const rlbFilter = ctx.createIIRFilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]);
  source.connect(preFilter).connect(rlbFilter).connect(ctx.destination);
  source.start();
  const weighted = await ctx.startRendering();

  // Mean square per 100 ms step; a 400 ms block is four consecutive steps
  const step = Math.round(weighted.sampleRate * 0.1);
  const stepCount = Math.floor(weighted.length / step);
  const stepPower = new Float64Array(stepCount);
  for (let c = 0; c < weighted.numberOfChannels; c++) {
    const samples = weighted.getChannelData(c);
    for (let s = 0; s < stepCount; s++) {
      let sum = 0;
      for (let i = s * step; i < (s + 1) * step; i++) sum += samples[i] * samples[i];
      stepPower[s] += sum / step;
    }
  }
  // A mono file is played on both speakers, which adds 3 dB compared with measuring one channel
  const channelFactor = weighted.numberOfChannels === 1 ? 2 : 1;

  const blockPowers: number[] = [];
  for (let s = 0; s + 4 <= stepCount; s++) {
    blockPowers.push(((stepPower[s] + stepPower[s + 1] + stepPower[s + 2] + stepPower[s + 3]) / 4) * channelFactor);
  }
  const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  const aboveAbsolute = blockPowers.filter((p) => p > 0 && toLufs(p) > -70);
  if (aboveAbsolute.length === 0) return null; // silent (or shorter than 0.4 s)
  const relativeGate = toLufs(mean(aboveAbsolute)) - 10;
  const gated = aboveAbsolute.filter((p) => toLufs(p) > relativeGate);
  return Math.round(toLufs(mean(gated)) * 10) / 10;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Active audio elements for playback
  private audioElements: Map<string, HTMLAudioElement> = new Map();

  // Output level meter: every media element is routed through masterGain, which feeds these analysers
  private analysers: { left: AnalyserNode; right: AnalyserNode } | null = null;
  private levelBuffer = new Float32Array(2048);
  private connectedElements = new WeakSet<HTMLMediaElement>();

  // Measured loudness per sound file URL
  private loudnessCache = new Map<string, Promise<number | null>>();

  // MediaRecorder for mic recording
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isStartingRecording = false;
  private recordStartedAt = 0;

  public init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);

      const splitter = this.ctx.createChannelSplitter(2);
      const left = this.ctx.createAnalyser();
      const right = this.ctx.createAnalyser();
      left.fftSize = right.fftSize = this.levelBuffer.length;
      this.masterGain.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
      this.analysers = { left, right };
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Sync audio playback at timeline currentTime
   */
  public syncPlayback(
    currentTime: number,
    isPlaying: boolean,
    audioTracks: AudioTrackItem[],
    videoClips: VideoClipItem[],
    mutedTracks?: ProjectData['mutedTracks']
  ) {
    this.init();

    // Speech actually being heard (same rule as the export): BGM ducks only under audible speech
    const speechSpans = getSpeechSpans(audioTracks, videoClips, mutedTracks);

    // Manage each track's HTMLAudioElement
    for (const track of audioTracks) {
      if (!track.dataUrl) continue;

      let el = this.audioElements.get(track.id);
      if (!el) {
        el = new Audio(track.dataUrl);
        el.loop = track.type === 'ambience' || track.type === 'bgm';
        this.audioElements.set(track.id, el);
        this.connectMediaElement(el);
      }

      const isInside = currentTime >= track.startTime && currentTime < track.startTime + track.duration;
      const isTrackMuted = mutedTracks && mutedTracks[track.type] === true;

      if (isPlaying && isInside && !isTrackMuted) {
        const targetSeek = (currentTime - track.startTime) + (track.trimStart || 0);
        if (Math.abs(el.currentTime - targetSeek) > 0.25) {
          el.currentTime = Math.max(0, targetSeek);
        }
        if (el.paused) {
          el.play().catch(() => {});
        }
        // Calculate fade-in and fade-out multipliers
        let fadeMultiplier = 1.0;
        const elapsedInClip = currentTime - track.startTime;
        const remainingInClip = (track.startTime + track.duration) - currentTime;

        const fadeIn = track.fadeInSec ?? (track.type === 'bgm' || track.type === 'ambience' ? 1.5 : 0.05);
        if (fadeIn > 0 && elapsedInClip < fadeIn) {
          fadeMultiplier = Math.max(0, elapsedInClip / fadeIn);
        }

        const fadeOut = track.fadeOutSec ?? (track.type === 'bgm' || track.type === 'ambience' ? 2.0 : 0.1);
        if (fadeOut > 0 && remainingInClip < fadeOut) {
          fadeMultiplier = Math.min(fadeMultiplier, Math.max(0, remainingInClip / fadeOut));
        }

        // Set volume with ducking and fade consideration
        if (track.type === 'bgm') {
          const ramp = track.autoDucking?.fadeSec ?? DEFAULT_DUCK_RAMP_SEC;
          const duckVal =
            track.autoDucking?.enabled === false
              ? 1
              : duckGainAt(mergeSpans(speechSpans, ramp * 2), currentTime, track.autoDucking?.duckVolume ?? DEFAULT_DUCK_VOLUME, ramp);
          el.volume = Math.max(0, Math.min(1, track.volume * duckVal * fadeMultiplier));
        } else {
          el.volume = Math.max(0, Math.min(1, track.volume * fadeMultiplier));
        }
      } else {
        if (!el.paused) {
          el.pause();
        }
      }
    }

    // Clean up deleted tracks
    for (const [id, el] of this.audioElements.entries()) {
      if (!audioTracks.some((t) => t.id === id)) {
        el.pause();
        el.src = '';
        this.audioElements.delete(id);
      }
    }
  }

  /**
   * The clock the speakers play by (the audio context's, smoothed between its updates), so the
   * playhead keeps pace with the sound instead of drifting away from it; the page's clock while
   * the audio context is not running (e.g. before the first click). Compare readings only while
   * `isAudioClock` stays the same.
   */
  public now(): { seconds: number; isAudioClock: boolean } {
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') {
      const stamp = ctx.getOutputTimestamp?.();
      if (stamp?.contextTime !== undefined && stamp.performanceTime) {
        return { seconds: stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000, isAudioClock: true };
      }
      return { seconds: ctx.currentTime, isAudioClock: true };
    }
    return { seconds: performance.now() / 1000, isAudioClock: false };
  }

  public pauseAll() {
    for (const el of this.audioElements.values()) {
      el.pause();
    }
  }

  /** Route a media element's sound through the engine so the level meter hears it */
  public connectMediaElement(el: HTMLMediaElement) {
    this.init();
    if (!this.ctx || !this.masterGain || this.connectedElements.has(el)) return;
    try {
      this.ctx.createMediaElementSource(el).connect(this.masterGain);
      this.connectedElements.add(el);
    } catch (e) {
      console.warn('Could not route media element through the level meter:', e);
    }
  }

  /** Current output level per channel in dBFS: RMS for the meter and peak for clipping (-Infinity when silent) */
  public getOutputLevels(): { left: number; right: number; peak: number } {
    if (!this.analysers) return { left: -Infinity, right: -Infinity, peak: -Infinity };
    let peak = 0;
    const rmsDb = (analyser: AnalyserNode) => {
      analyser.getFloatTimeDomainData(this.levelBuffer);
      let sum = 0;
      for (const x of this.levelBuffer) {
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
      const rms = Math.sqrt(sum / this.levelBuffer.length);
      return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    };
    const left = rmsDb(this.analysers.left);
    const right = rmsDb(this.analysers.right);
    return { left, right, peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
  }

  /**
   * Integrated loudness (LUFS) of a sound file played at 100% volume, or null if it cannot be
   * decoded or is silent. Results are cached per URL.
   */
  public measureLoudness(url: string): Promise<number | null> {
    let result = this.loudnessCache.get(url);
    if (!result) {
      result = measureIntegratedLoudness(url).catch((e) => {
        console.warn('Loudness measurement failed:', e);
        return null;
      });
      this.loudnessCache.set(url, result);
    }
    return result;
  }

  /**
   * Microphone recording feature
   */
  public async startRecording(): Promise<void> {
    // A second recorder would orphan the first one and mix both into recordedChunks
    if (this.mediaRecorder || this.isStartingRecording) {
      throw new Error('すでに録音中です');
    }
    this.isStartingRecording = true;
    try {
      this.recordedChunks = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.start(100);
      this.recordStartedAt = performance.now();
    } finally {
      this.isStartingRecording = false;
    }
  }

  public stopRecording(): Promise<{ blob: Blob; url: string; duration: number }> {
    return new Promise((resolve, reject) => {
      const recorder = this.mediaRecorder;
      if (!recorder) {
        return reject(new Error('Recorder not started'));
      }
      const elapsedSec = (performance.now() - this.recordStartedAt) / 1000;

      recorder.onstop = async () => {
        // Stop microphone stream tracks
        recorder.stream.getTracks().forEach((t) => t.stop());
        this.mediaRecorder = null;

        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);

        // Chrome's MediaRecorder WebM has no duration header, so <audio>.duration reports Infinity.
        // Decode the audio for the real length, falling back to the wall-clock recording time.
        let duration = elapsedSec;
        try {
          this.init();
          const decoded = await this.ctx!.decodeAudioData(await blob.arrayBuffer());
          if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
            duration = decoded.duration;
          }
        } catch (e) {
          console.warn('Could not decode recording, using elapsed time as duration:', e);
        }

        resolve({ blob, url, duration });
      };

      recorder.stop();
    });
  }

  public isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }

  /**
   * Extract audio waveform amplitude peaks (0.0 to 1.0) using Web Audio API
   */
  public async extractWaveform(blob: Blob, sampleCount = 60): Promise<number[]> {
    this.init();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      // Decode audio
      const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);
      const blockSize = Math.floor(channelData.length / sampleCount);
      const peaks: number[] = [];

      for (let i = 0; i < sampleCount; i++) {
        const start = i * blockSize;
        let sum = 0;
        let count = 0;
        for (let j = 0; j < blockSize && start + j < channelData.length; j += 4) {
          sum += Math.abs(channelData[start + j]);
          count++;
        }
        peaks.push(count > 0 ? sum / count : 0);
      }

      // Normalize peaks
      const max = Math.max(...peaks, 0.01);
      return peaks.map((p) => Math.max(0.12, Math.min(1.0, p / max)));
    } catch (e) {
      console.warn('Could not decode audio for the waveform display:', e);
      return []; // no waveform rather than a made-up one
    }
  }
}

export interface LoudnessProfile {
  id: 'youtube' | 'sacred_calm' | 'shorts';
  name: string;
  badge: string;
  targetLufs: number;
  description: string;
  narrationTargetLufs: number;
  bgmTargetLufs: number;
  ambienceTargetLufs: number;
  defaultDuckingVolume: number;
}

export const LOUDNESS_PROFILES: Record<'youtube' | 'sacred_calm' | 'shorts', LoudnessProfile> = {
  youtube: {
    id: 'youtube',
    name: 'YouTube 標準',
    badge: '-14 LUFS',
    targetLufs: -14,
    description: 'YouTubeやポッドキャストの公式推奨規格。声が前に出て、BGMが静かに寄り添う黄金バランス。',
    narrationTargetLufs: -14,
    bgmTargetLufs: -24,
    ambienceTargetLufs: -28,
    defaultDuckingVolume: 0.22,
  },
  sacred_calm: {
    id: 'sacred_calm',
    name: '神聖・静寂重視',
    badge: '-18 LUFS',
    targetLufs: -18,
    description: '神社・瞑想・睡眠導入動画用。音圧を抑えて自然音と空間の静けさを際立たせる設計。',
    narrationTargetLufs: -18,
    bgmTargetLufs: -27,
    ambienceTargetLufs: -30,
    defaultDuckingVolume: 0.18,
  },
  shorts: {
    id: 'shorts',
    name: 'Shorts / スマホ特化',
    badge: '-12 LUFS',
    targetLufs: -12,
    description: '縦型ショート動画・リール用。スマホの内蔵スピーカーでもくっきりクリアに抜ける高音圧。',
    narrationTargetLufs: -12,
    bgmTargetLufs: -21,
    ambienceTargetLufs: -25,
    defaultDuckingVolume: 0.28,
  },
};

export const audioEngine = new AudioEngine();
