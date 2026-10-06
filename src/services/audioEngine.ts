/**
 * Web Audio Engine for Sacred Sanctuary Studio
 * Supports multi-track mixing (Narration, Ambience, BGM),
 * Microphone recording, and automatic BGM Ducking.
 */
import { AudioTrackItem } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private narrationGain: GainNode | null = null;
  private masterGain: GainNode | null = null;

  // Active audio elements for playback
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  // Procedural synthesizer nodes for sample serene sound
  private synthNodes: { stop: () => void } | null = null;

  // MediaRecorder for mic recording
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  public init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.connect(this.masterGain);

      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.connect(this.masterGain);

      this.narrationGain = this.ctx.createGain();
      this.narrationGain.connect(this.masterGain);
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
    mutedTracks?: { narration?: boolean; ambience?: boolean; bgm?: boolean }
  ) {
    this.init();

    // Check if narration is currently active at this timestamp
    const isNarrationActive = audioTracks.some(
      (t) =>
        t.type === 'narration' &&
        currentTime >= t.startTime &&
        currentTime < t.startTime + t.duration
    );

    // Apply auto ducking to BGM
    const bgmTrack = audioTracks.find((t) => t.type === 'bgm');
    const isBgmMuted = mutedTracks?.bgm === true;
    if (this.bgmGain && this.ctx) {
      const baseVol = isBgmMuted ? 0 : (bgmTrack ? bgmTrack.volume : 0.6);
      let targetBgmVol = baseVol;
      if (isNarrationActive && bgmTrack?.autoDucking?.enabled !== false && !isBgmMuted) {
        const duckVal = bgmTrack?.autoDucking?.duckVolume ?? 0.2;
        targetBgmVol = baseVol * duckVal;
      }
      this.bgmGain.gain.setTargetAtTime(targetBgmVol, this.ctx.currentTime, 0.15);
    }

    // Manage each track's HTMLAudioElement
    for (const track of audioTracks) {
      if (!track.dataUrl) continue;

      let el = this.audioElements.get(track.id);
      if (!el) {
        el = new Audio(track.dataUrl);
        el.loop = track.type === 'ambience' || track.type === 'bgm';
        this.audioElements.set(track.id, el);
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
          const duckVal = isNarrationActive ? (track.autoDucking?.duckVolume ?? 0.22) : 1.0;
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

    // Procedural peaceful ambient sound generator if no audio tracks exist
    if (audioTracks.length === 0 && isPlaying) {
      this.startPeacefulDrone();
    } else {
      this.stopPeacefulDrone();
    }
  }

  public pauseAll() {
    for (const el of this.audioElements.values()) {
      el.pause();
    }
    this.stopPeacefulDrone();
  }

  /**
   * Procedural peaceful shrine sound (Singing bowl / gentle bell drone)
   */
  private startPeacefulDrone() {
    if (this.synthNodes || !this.ctx) return;
    try {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(144, this.ctx.currentTime); // D3 (serene key)
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(216, this.ctx.currentTime); // A3 harmonic

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);

      osc1.start();
      osc2.start();

      this.synthNodes = {
        stop: () => {
          try {
            osc1.stop();
            osc2.stop();
            osc1.disconnect();
            osc2.disconnect();
          } catch {}
          this.synthNodes = null;
        },
      };
    } catch {}
  }

  private stopPeacefulDrone() {
    if (this.synthNodes) {
      this.synthNodes.stop();
      this.synthNodes = null;
    }
  }

  /**
   * Microphone recording feature
   */
  public async startRecording(): Promise<void> {
    this.recordedChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.mediaRecorder.start(100);
  }

  public stopRecording(): Promise<{ blob: Blob; url: string; duration: number }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        return reject(new Error('Recorder not started'));
      }

      this.mediaRecorder.onstop = async () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        
        // Calculate audio duration
        const tempAudio = new Audio(url);
        tempAudio.onloadedmetadata = () => {
          resolve({
            blob,
            url,
            duration: tempAudio.duration || 3.0,
          });
        };
        tempAudio.onerror = () => {
          resolve({
            blob,
            url,
            duration: 3.0,
          });
        };

        // Stop microphone stream tracks
        this.mediaRecorder?.stream.getTracks().forEach((t) => t.stop());
        this.mediaRecorder = null;
      };

      this.mediaRecorder.stop();
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
      console.warn('Direct decodeAudioData not available for format, fallback to speech pattern:', e);
      return this.generateSyntheticWaveform('narration', sampleCount);
    }
  }

  /**
   * Generate natural procedural waveform for presets or audio files
   */
  public generateSyntheticWaveform(type: 'bgm' | 'ambience' | 'narration', sampleCount = 60): number[] {
    const peaks: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;
      if (type === 'narration') {
        const isPause = (i % 14 > 10) || (i % 23 > 19);
        if (isPause) {
          peaks.push(0.08 + Math.random() * 0.05);
        } else {
          const envelope = 0.35 + 0.5 * Math.sin(t * Math.PI * 4);
          const noise = Math.random() * 0.35;
          peaks.push(Math.max(0.2, Math.min(0.95, Math.abs(envelope) + noise)));
        }
      } else if (type === 'bgm') {
        const wave = 0.45 + 0.3 * Math.sin(t * Math.PI * 2) + 0.15 * Math.sin(t * Math.PI * 6);
        peaks.push(Math.max(0.25, Math.min(0.92, wave + Math.random() * 0.1)));
      } else {
        const wave = 0.35 + 0.15 * Math.sin(t * Math.PI * 3);
        peaks.push(Math.max(0.2, Math.min(0.7, wave + Math.random() * 0.12)));
      }
    }
    return peaks;
  }
  /**
   * Estimates integrated loudness (LUFS) of a track based on waveform and volume
   */
  public calculateLoudness(track: AudioTrackItem): { rms: number; peak: number; estimatedLufs: number } {
    const peaks = track.waveform && track.waveform.length > 0
      ? track.waveform
      : [0.4, 0.5, 0.6, 0.5, 0.4];

    let sumSq = 0;
    let maxPeak = 0;
    for (const p of peaks) {
      sumSq += p * p;
      if (p > maxPeak) maxPeak = p;
    }
    const rms = Math.sqrt(sumSq / peaks.length);
    const effectiveRms = rms * Math.max(0.01, track.volume);

    // Approximate LUFS mapping based on full-scale RMS
    const rawLufs = 20 * Math.log10(Math.max(0.001, effectiveRms)) - 2.0;
    const estimatedLufs = Math.max(-45, Math.min(-6, Math.round(rawLufs * 10) / 10));

    return {
      rms: Math.round(effectiveRms * 100) / 100,
      peak: Math.round(maxPeak * track.volume * 100) / 100,
      estimatedLufs,
    };
  }

  /**
   * Normalizes a single track to a target LUFS level
   */
  public normalizeTrack(
    track: AudioTrackItem,
    targetLufs: number
  ): { updatedTrack: AudioTrackItem; gainDeltaDb: number; prevLufs: number; newLufs: number } {
    const current = this.calculateLoudness(track);
    const gainDeltaDb = targetLufs - current.estimatedLufs;

    // Linear multiplier change: 10^(gainDeltaDb / 20)
    const multiplier = Math.pow(10, gainDeltaDb / 20);
    const newVolume = Math.max(0.05, Math.min(1.0, Math.round(track.volume * multiplier * 100) / 100));

    const updatedTrack: AudioTrackItem = {
      ...track,
      volume: newVolume,
      estimatedLufs: targetLufs,
    };

    const newCalculated = this.calculateLoudness(updatedTrack);

    return {
      updatedTrack: { ...updatedTrack, estimatedLufs: newCalculated.estimatedLufs },
      gainDeltaDb: Math.round(gainDeltaDb * 10) / 10,
      prevLufs: current.estimatedLufs,
      newLufs: newCalculated.estimatedLufs,
    };
  }

  /**
   * Normalizes all audio tracks in the project to the selected standard loudness profile
   */
  public normalizeAllTracks(
    tracks: AudioTrackItem[],
    profileKey: 'youtube' | 'sacred_calm' | 'shorts' = 'youtube'
  ): {
    updatedTracks: AudioTrackItem[];
    summary: { trackName: string; type: string; oldVol: number; newVol: number; oldLufs: number; newLufs: number; gainDeltaDb: number }[];
  } {
    const profile = LOUDNESS_PROFILES[profileKey];
    const summary: { trackName: string; type: string; oldVol: number; newVol: number; oldLufs: number; newLufs: number; gainDeltaDb: number }[] = [];

    const updatedTracks = tracks.map((track) => {
      let targetLufs = profile.narrationTargetLufs;
      if (track.type === 'bgm') targetLufs = profile.bgmTargetLufs;
      if (track.type === 'ambience') targetLufs = profile.ambienceTargetLufs;

      const normResult = this.normalizeTrack(track, targetLufs);

      let finalTrack = normResult.updatedTrack;
      if (finalTrack.type === 'bgm') {
        finalTrack = {
          ...finalTrack,
          autoDucking: {
            enabled: finalTrack.autoDucking?.enabled ?? true,
            duckVolume: profile.defaultDuckingVolume,
            fadeSec: finalTrack.autoDucking?.fadeSec ?? 0.4,
          },
        };
      }

      summary.push({
        trackName: track.name,
        type: track.type,
        oldVol: track.volume,
        newVol: finalTrack.volume,
        oldLufs: normResult.prevLufs,
        newLufs: normResult.newLufs,
        gainDeltaDb: normResult.gainDeltaDb,
      });

      return finalTrack;
    });

    return { updatedTracks, summary };
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
