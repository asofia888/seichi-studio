/**
 * Video Exporter Service
 * Exports the project timeline by rendering frames onto an Canvas
 * and capturing with MediaRecorder with complete multi-track audio mixdown
 * (Narration, BGM auto-ducking, Ambience, and smooth fade-in/fade-out).
 */
import { ProjectData, SupportedLanguage, AudioTrackItem } from '../types';
import { canvasRenderer } from './canvasRenderer';

export interface ExportProgress {
  currentSecond: number;
  totalSeconds: number;
  percentage: number;
  statusText: string;
}

/**
 * Pre-render all project audio tracks into a single unified stereo AudioBuffer
 * with accurate timing, volume levels, fade-in/out, and BGM auto-ducking during speech.
 */
async function renderMixedAudioBuffer(project: ProjectData, duration: number): Promise<AudioBuffer | null> {
  const sampleRate = 44100;
  const totalSamples = Math.max(1, Math.ceil(duration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Decode helper using standard audio context
  const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  // Find all narration tracks to compute ducking intervals
  const narrationClips = project.audioTracks.filter((t) => t.type === 'narration');

  let hasAudibleContent = false;

  for (const track of project.audioTracks) {
    if (track.startTime >= duration) continue;

    let audioBuffer: AudioBuffer | null = null;

    if (track.dataUrl) {
      try {
        const resp = await fetch(track.dataUrl);
        const arrayBuf = await resp.arrayBuffer();
        audioBuffer = await tempCtx.decodeAudioData(arrayBuf);
      } catch (err) {
        console.warn(`Could not decode audio for track ${track.name}, generating synthetic tone:`, err);
      }
    }

    // If no buffer (e.g. preset BGM or procedural ambience), synthesize serene background sound
    if (!audioBuffer) {
      audioBuffer = createProceduralAudioBuffer(offlineCtx, track.type, Math.min(duration, track.duration));
    }

    if (!audioBuffer) continue;

    hasAudibleContent = true;

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = track.type === 'bgm' || track.type === 'ambience';

    const gainNode = offlineCtx.createGain();
    const baseVol = Math.max(0, Math.min(1.0, track.volume));
    gainNode.gain.setValueAtTime(baseVol, 0);

    const clipStart = Math.max(0, track.startTime);
    const clipEnd = Math.min(duration, track.startTime + track.duration);
    const offset = Math.max(0, track.trimStart || 0);

    // Apply Fade In
    const fadeIn = track.fadeInSec ?? (track.type === 'bgm' || track.type === 'ambience' ? 1.5 : 0.05);
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(0, clipStart);
      gainNode.gain.linearRampToValueAtTime(baseVol, Math.min(clipEnd, clipStart + fadeIn));
    }

    // Apply Fade Out
    const fadeOut = track.fadeOutSec ?? (track.type === 'bgm' || track.type === 'ambience' ? 2.0 : 0.1);
    if (fadeOut > 0 && clipEnd - fadeOut > clipStart) {
      gainNode.gain.setValueAtTime(baseVol, clipEnd - fadeOut);
      gainNode.gain.linearRampToValueAtTime(0, clipEnd);
    }

    // Apply Auto Ducking on BGM when narration is speaking
    if (track.type === 'bgm' && track.autoDucking?.enabled !== false && narrationClips.length > 0) {
      const duckVol = baseVol * (track.autoDucking?.duckVolume ?? 0.22);
      const rampTime = track.autoDucking?.fadeSec ?? 0.35;

      for (const narr of narrationClips) {
        const nStart = Math.max(clipStart, narr.startTime);
        const nEnd = Math.min(clipEnd, narr.startTime + narr.duration);

        if (nEnd > nStart) {
          gainNode.gain.setValueAtTime(baseVol, Math.max(0, nStart - rampTime));
          gainNode.gain.linearRampToValueAtTime(duckVol, nStart);
          gainNode.gain.setValueAtTime(duckVol, nEnd);
          gainNode.gain.linearRampToValueAtTime(baseVol, Math.min(clipEnd, nEnd + rampTime));
        }
      }
    }

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    try {
      source.start(clipStart, offset, track.duration);
    } catch {
      source.start(clipStart, offset);
    }
  }

  tempCtx.close().catch(() => {});

  if (!hasAudibleContent) return null;

  try {
    return await offlineCtx.startRendering();
  } catch (e) {
    console.error('Failed to render offline audio mixdown:', e);
    return null;
  }
}

/**
 * Creates a soothing procedural meditation tone if external audio file is not loaded
 */
function createProceduralAudioBuffer(ctx: BaseAudioContext, type: string, durationSec: number): AudioBuffer {
  const dur = Math.max(2, Math.min(120, durationSec));
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(2, Math.ceil(dur * rate), rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const freq1 = type === 'bgm' ? 144 : 220; // D3 / A3
  const freq2 = type === 'bgm' ? 216 : 330;

  for (let i = 0; i < buffer.length; i++) {
    const t = i / rate;
    const env = 0.5 + 0.5 * Math.sin(t * 0.5);
    const s1 = Math.sin(2 * Math.PI * freq1 * t) * 0.08 * env;
    const s2 = Math.sin(2 * Math.PI * freq2 * t) * 0.05 * env;
    left[i] = s1 + s2;
    right[i] = s1 - s2;
  }

  return buffer;
}

export async function exportProjectVideo(
  project: ProjectData,
  exportLang: SupportedLanguage = 'ja',
  onProgress?: (p: ExportProgress) => void
): Promise<Blob> {
  const isLandscape = project.aspectRatio === '16:9';
  const width = isLandscape ? 1920 : 1080;
  const height = isLandscape ? 1080 : 1920;
  const fps = 30;
  const duration = Math.max(1, project.duration);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. Pre-cache media assets
  onProgress?.({
    currentSecond: 0,
    totalSeconds: duration,
    percentage: 3,
    statusText: 'メディア素材の読み込みと準備中...',
  });

  for (const clip of project.videoClips) {
    if (clip.dataUrl) {
      if (clip.type === 'image') {
        await canvasRenderer.preloadImage(clip.dataUrl).catch(() => {});
      }
    }
  }

  // 2. Pre-render full multi-track audio soundtrack with ducking and fades
  onProgress?.({
    currentSecond: 0,
    totalSeconds: duration,
    percentage: 8,
    statusText: 'マルチトラック音声の完全ミックスダウン合成中 (自動ダッキング・フェード反映)...',
  });

  const mixedAudioBuffer = await renderMixedAudioBuffer(project, duration);

  // 3. Setup Canvas Video Stream & Mixed Audio Stream
  const stream = canvas.captureStream(fps);

  let playCtx: AudioContext | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;

  if (mixedAudioBuffer) {
    playCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioDest = playCtx.createMediaStreamDestination();

    sourceNode = playCtx.createBufferSource();
    sourceNode.buffer = mixedAudioBuffer;
    sourceNode.connect(audioDest);

    const audioTracks = audioDest.stream.getAudioTracks();
    if (audioTracks.length > 0) {
      stream.addTrack(audioTracks[0]);
    }
  }

  // Determine supported container & codec
  let mimeType = 'video/webm;codecs=vp9,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8,opus';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }

  const recordedChunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 14000000, // 14 Mbps pristine quality
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  recorder.start();
  if (sourceNode) {
    sourceNode.start(0);
  }

  // 4. Render frames with pacing to match audio and prevent dropped frames
  const totalFrames = Math.ceil(duration * fps);
  const frameInterval = 1 / fps;
  const frameDelayMs = Math.floor(1000 / fps);

  for (let f = 0; f < totalFrames; f++) {
    const currentTime = f * frameInterval;

    canvasRenderer.renderFrame(ctx, project, currentTime, exportLang, false);

    // Keep pace with audio recording
    const pct = Math.floor(10 + (f / totalFrames) * 85);
    if (f % 10 === 0 || f === totalFrames - 1) {
      onProgress?.({
        currentSecond: Math.floor(currentTime),
        totalSeconds: Math.floor(duration),
        percentage: pct,
        statusText: `レンダリング中 (${Math.floor(currentTime)}秒 / ${Math.floor(duration)}秒)...`,
      });
    }

    await new Promise((r) => setTimeout(r, frameDelayMs));
  }

  onProgress?.({
    currentSecond: Math.floor(duration),
    totalSeconds: Math.floor(duration),
    percentage: 98,
    statusText: '音声と映像の同期パッキング完了処理中...',
  });

  // Stop recorder and clean up
  const finalBlob: Blob = await new Promise((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(recordedChunks, { type: mimeType }));
    };
    recorder.stop();
  });

  if (sourceNode) {
    try {
      sourceNode.stop();
    } catch {}
  }
  if (playCtx) {
    playCtx.close().catch(() => {});
  }

  onProgress?.({
    currentSecond: Math.floor(duration),
    totalSeconds: Math.floor(duration),
    percentage: 100,
    statusText: '書き出し完了！',
  });

  return finalBlob;
}
