/**
 * The exported soundtrack, worked out a block at a time.
 *
 * `planSoundtrack` turns a project into a list of voices (each sound that is heard, with where
 * it plays, from which second of its file, and how its volume moves), and `mixVoice` adds one
 * voice to a block of the mix. Every sample is computed from its absolute position on the
 * timeline, so the mix is the same wherever the blocks are cut — which is what lets an
 * hour-long soundtrack be produced a few seconds at a time instead of being held in memory.
 *
 * Pure functions on sample arrays; reading and decoding the files is in soundtrackMixer.ts.
 */
import { ProjectData } from '../types';
import { DEFAULT_DUCK_RAMP_SEC, DEFAULT_DUCK_VOLUME, getSpeechSpans, mergeSpans } from './audioEngine';
import { clipSoundSpan, clipSpeed } from './composition';

/** Sample rate of the mix */
export const MIX_SAMPLE_RATE = 48000;

/** A corner of a volume curve: `v` at timeline second `t`, with straight lines between corners */
export interface EnvelopePoint {
  t: number;
  v: number;
}

/** One sound in the mix */
export interface Voice {
  /** For messages about it */
  name: string;
  url: string;
  /** A sound file on the audio tracks, or the sound recorded with a video clip */
  kind: 'track' | 'clip';
  /** Timeline seconds it is heard over */
  start: number;
  end: number;
  /** Second of the file that plays at `start` */
  sourceOffset: number;
  /** Source seconds per timeline second */
  speed: number;
  /** Start again from the beginning of the file when it ends (BGM, ambience) */
  loop: boolean;
  /** Its volume with the fades at both ends */
  fade: EnvelopePoint[];
  /** BGM only: how far it is turned down while someone speaks */
  duck: EnvelopePoint[] | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Volume `volume` between `start` and `end`, fading in and out at the ends */
export function fadeEnvelope(start: number, end: number, volume: number, fadeIn: number, fadeOut: number): EnvelopePoint[] {
  const fadeInEnd = Math.min(end, start + Math.max(0, fadeIn));
  const points: EnvelopePoint[] = [{ t: start, v: fadeIn > 0 ? 0 : volume }];
  if (fadeIn > 0) points.push({ t: fadeInEnd, v: volume });
  if (fadeOut > 0) {
    // Never start fading out before the fade-in has finished
    points.push({ t: Math.max(fadeInEnd, end - fadeOut), v: volume }, { t: end, v: 0 });
  }
  return points;
}

/** The curve the preview follows (duckGainAt): down to `level` over `ramp` before speech, back up after it */
export function duckEnvelope(speech: [number, number][], level: number, ramp: number): EnvelopePoint[] {
  const points: EnvelopePoint[] = [];
  for (const [s, e] of mergeSpans(speech, ramp * 2)) {
    points.push({ t: Math.max(0, s - ramp), v: 1 }, { t: Math.max(0, s), v: level }, { t: e, v: level }, { t: e + ramp, v: 1 });
  }
  return points;
}

/**
 * Every sound heard in the first `duration` seconds of the project. Mirrors the preview: muted
 * tracks and tracks without a sound file are silent.
 */
export function planSoundtrack(project: ProjectData, duration: number): Voice[] {
  const muted = project.mutedTracks || {};
  const voices: Voice[] = [];

  // Narrations and talking in video clips: the BGM ducks under both
  const speech = getSpeechSpans(project.audioTracks, project.videoClips, muted)
    .map(([s, e]): [number, number] => [s, Math.min(duration, e)])
    .filter(([s, e]) => e > s);

  for (const track of project.audioTracks) {
    if (muted[track.type] || !track.dataUrl) continue;
    const start = Math.max(0, track.startTime);
    const end = Math.min(duration, track.startTime + track.duration);
    if (end <= start) continue;

    const isLooped = track.type === 'bgm' || track.type === 'ambience';
    const fadeIn = track.fadeInSec ?? (isLooped ? 1.5 : 0.05);
    const fadeOut = track.fadeOutSec ?? (isLooped ? 2.0 : 0.1);
    const ducks = track.type === 'bgm' && track.autoDucking?.enabled !== false && speech.length > 0;
    voices.push({
      name: track.name,
      url: track.dataUrl,
      kind: 'track',
      start,
      end,
      sourceOffset: Math.max(0, track.trimStart || 0),
      speed: 1,
      loop: isLooped,
      fade: fadeEnvelope(start, end, clamp01(track.volume), fadeIn, fadeOut),
      duck: ducks
        ? duckEnvelope(speech, track.autoDucking?.duckVolume ?? DEFAULT_DUCK_VOLUME, track.autoDucking?.fadeSec ?? DEFAULT_DUCK_RAMP_SEC)
        : null,
    });
  }

  // Original sound recorded with the video clips (crossfaded at dissolves, sped up or slowed down with the picture)
  if (!muted.video) {
    for (const clip of project.videoClips) {
      const volume = clamp01(clip.volume ?? 1);
      if (clip.type !== 'video' || !clip.dataUrl || volume === 0) continue;
      const span = clipSoundSpan(project, clip);
      const start = Math.max(0, span.start);
      const end = Math.min(duration, span.end);
      if (end <= start) continue;
      const speed = clipSpeed(clip);
      voices.push({
        name: clip.name,
        url: clip.dataUrl,
        kind: 'clip',
        start,
        end,
        sourceOffset: span.sourceOffset + (start - span.start) * speed,
        speed,
        loop: false,
        fade: fadeEnvelope(start, end, volume, span.fadeIn, span.fadeOut),
        duck: null,
      });
    }
  }
  return voices;
}

// ---------------------------------------------------------------------------
// Volume curves
// ---------------------------------------------------------------------------

/** The curve's value at `t`: level before its first corner and after its last. Where two corners share a time, the later one counts. */
export function envelopeValueAt(points: EnvelopePoint[], t: number): number {
  if (points.length === 0) return 1;
  if (t < points[0].t) return points[0].v;
  let i = 0;
  while (i + 1 < points.length && points[i + 1].t <= t) i++;
  if (i + 1 === points.length) return points[i].v;
  const a = points[i];
  const b = points[i + 1];
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/**
 * The curve for the samples `fromSample`, `fromSample + 1`, ... written to (or, with `multiply`,
 * multiplied into) `target`.
 */
export function writeEnvelope(target: Float32Array, points: EnvelopePoint[], fromSample: number, multiply = false): void {
  if (points.length === 0) {
    if (!multiply) target.fill(1);
    return;
  }
  let i = -1; // the last corner at or before the sample's time (-1: before the first)
  for (let n = 0; n < target.length; n++) {
    const t = (fromSample + n) / MIX_SAMPLE_RATE;
    while (i + 1 < points.length && points[i + 1].t <= t) i++;
    let v: number;
    if (i < 0) v = points[0].v;
    else if (i + 1 === points.length) v = points[i].v;
    else {
      const a = points[i];
      const b = points[i + 1];
      v = a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
    target[n] = multiply ? target[n] * v : v;
  }
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

/** Decoded sound of (part of) a file */
export interface SourceSound {
  /** One (mono, heard on both sides) or two channels */
  channels: Float32Array[];
  sampleRate: number;
  /** Second of the file the first sample is at */
  start: number;
}

/** Where a voice's sound comes from */
export interface VoiceSource {
  /** Length of the file's sound in seconds (where a looped sound starts again); null when unknown */
  duration: number | null;
  /**
   * The file's sound from second `from` to `to`, or more (a little before and after is welcome:
   * it is used to smooth between samples). Null when there is none.
   */
  read(from: number, to: number): Promise<SourceSound | null>;
}

/** A run of output samples that plays one unbroken stretch of the file */
export interface VoicePiece {
  /** Output samples `from` (inclusive) to `to` (exclusive), counted from the start of the timeline */
  from: number;
  to: number;
  /** Second of the file that plays at `from` */
  sourceFrom: number;
}

/**
 * What a voice plays during output samples `from` to `to`. A looped voice is cut where its file
 * starts again; `loopSec` is the file's length (null: do not loop).
 */
export function voicePieces(voice: Voice, loopSec: number | null, from: number, to: number): VoicePiece[] {
  const first = Math.round(voice.start * MIX_SAMPLE_RATE);
  const a = Math.max(from, first);
  const b = Math.min(to, Math.round(voice.end * MIX_SAMPLE_RATE));
  if (b <= a) return [];
  const perSample = voice.speed / MIX_SAMPLE_RATE;
  const sourceAt = (n: number) => voice.sourceOffset + (n - first) * perSample;
  if (!voice.loop || loopSec === null || !(loopSec > 0.001)) return [{ from: a, to: b, sourceFrom: sourceAt(a) }];

  const pieces: VoicePiece[] = [];
  let n = a;
  while (n < b) {
    const position = sourceAt(n);
    let within = position - Math.floor(position / loopSec) * loopSec;
    // A hair before the end of the file is the beginning of the next round
    if (loopSec - within < perSample * 1e-6) within = 0;
    const untilEnd = Math.max(1, Math.ceil((loopSec - within) / perSample - 1e-6));
    const end = Math.min(b, n + untilEnd);
    pieces.push({ from: n, to: end, sourceFrom: within });
    n = end;
  }
  return pieces;
}

/**
 * Add the samples of `piece` that fall in the block to `out` (two channels, beginning at output
 * sample `blockStart`), each multiplied by `gain` (one value per sample of the block).
 */
export function addPiece(
  out: Float32Array[],
  blockStart: number,
  piece: VoicePiece,
  speed: number,
  sound: SourceSound,
  gain: Float32Array
): void {
  const length = sound.channels[0]?.length ?? 0;
  if (length === 0) return;
  // Source samples per output sample, and the (fractional) source sample that plays at piece.from
  const step = (speed * sound.sampleRate) / MIX_SAMPLE_RATE;
  const origin = (piece.sourceFrom - sound.start) * sound.sampleRate;
  const from = Math.max(piece.from, blockStart);
  const to = Math.min(piece.to, blockStart + out[0].length);

  for (let c = 0; c < out.length; c++) {
    const source = sound.channels[Math.min(c, sound.channels.length - 1)];
    const target = out[c];

    if (Math.abs(step - 1) < 1e-9) {
      // Same rate and speed: the samples are copied as they are
      const shift = Math.round(origin) - piece.from;
      const first = Math.max(from, -shift);
      const last = Math.min(to, length - shift);
      for (let n = first; n < last; n++) target[n - blockStart] += source[n + shift] * gain[n - blockStart];
      continue;
    }

    // Otherwise each sample is read between the file's samples, on a smooth curve through the
    // four around it (Catmull-Rom)
    for (let n = from; n < to; n++) {
      const x = origin + (n - piece.from) * step;
      if (x < 0 || x >= length) continue; // before the file's sound begins, or after it ends
      const i = Math.floor(x);
      const f = x - i;
      const p1 = source[i];
      const p0 = i > 0 ? source[i - 1] : p1;
      const p2 = i + 1 < length ? source[i + 1] : p1;
      const p3 = i + 2 < length ? source[i + 2] : p2;
      const value = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
      target[n - blockStart] += value * gain[n - blockStart];
    }
  }
}

/**
 * Add `voice` to a block of the mix: `out` holds the two channels, beginning at output sample
 * `blockStart`. `scratch` is working space of at least the block's length.
 */
export async function mixVoice(
  out: Float32Array[],
  blockStart: number,
  voice: Voice,
  source: VoiceSource,
  scratch: Float32Array
): Promise<void> {
  const blockLength = out[0].length;
  const pieces = voicePieces(voice, voice.loop ? source.duration : null, blockStart, blockStart + blockLength);
  if (pieces.length === 0) return;

  const gain = scratch.subarray(0, blockLength);
  writeEnvelope(gain, voice.fade, blockStart);
  if (voice.duck) writeEnvelope(gain, voice.duck, blockStart, true);

  for (const piece of pieces) {
    const seconds = ((piece.to - piece.from) * voice.speed) / MIX_SAMPLE_RATE;
    const sound = await source.read(piece.sourceFrom, piece.sourceFrom + seconds);
    if (sound) addPiece(out, blockStart, piece, voice.speed, sound, gain);
  }
}

/**
 * Fold surround sound down to stereo the way a player does (ITU-R BS.775): the centre and the
 * surrounds are shared between left and right at -3 dB; the bass channel is left out. One or
 * two channels are returned as they are.
 */
export function downmixToStereo(channels: Float32Array[]): Float32Array[] {
  if (channels.length <= 2) return channels;
  const length = channels[0].length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  if (channels.length === 4) {
    // Quad: front and back of each side
    for (let i = 0; i < length; i++) {
      left[i] = 0.5 * (channels[0][i] + channels[2][i]);
      right[i] = 0.5 * (channels[1][i] + channels[3][i]);
    }
  } else if (channels.length >= 6) {
    // 5.1: L, R, C, LFE, SL, SR
    const [l, r, c, , sl, sr] = channels;
    for (let i = 0; i < length; i++) {
      left[i] = l[i] + Math.SQRT1_2 * (c[i] + sl[i]);
      right[i] = r[i] + Math.SQRT1_2 * (c[i] + sr[i]);
    }
  } else {
    left.set(channels[0]);
    right.set(channels[1]);
  }
  return [left, right];
}
