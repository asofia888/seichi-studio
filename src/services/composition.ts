/**
 * What the picture is made of at a given moment, shared by the preview, the export and the
 * thumbnail so all three always agree: the main-track clip (two of them during a transition),
 * a dip to black or white, and a B-roll clip laid over the main track. Also when each video
 * clip's own sound is heard, since transitions blend the sound along with the picture.
 * Pure functions on ProjectData.
 */
import { ProjectData, TransitionType, VideoClipItem } from '../types';

// Clips this close are back to back, so a transition joins them
const ADJACENT_SEC = 0.05;
// A video clip's own sound fades in and out this quickly at a plain cut, so it does not click
const CUT_FADE_IN_SEC = 0.05;
const CUT_FADE_OUT_SEC = 0.1;

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

export interface PictureLayer {
  clip: VideoClipItem;
  /** Seconds into the source file that a video shows now (already sped up or slowed down) */
  sourceTime: number;
  /** How far through the clip, 0 to 1, for a photo's slow zoom */
  progress: number;
  /** Opacity, 0 to 1 */
  alpha: number;
}

export interface Picture {
  /** Main-track clips, bottom first: one, or two while one dissolves into the next */
  main: PictureLayer[];
  /** B-roll over the main track */
  overlay: PictureLayer | null;
  /** A dip to black or white over the whole picture (fade transitions) */
  dip: { color: 'black' | 'white'; alpha: number } | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const isOverlayClip = (clip: VideoClipItem) => clip.track === 'overlay';

export const clipSpeed = (clip: VideoClipItem) =>
  clip.type === 'video' && clip.speed && clip.speed > 0 ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, clip.speed)) : 1;

/** Seconds into the source file shown at timeline time `t` (before the clip: its first frame) */
export function sourceTimeAt(clip: VideoClipItem, t: number): number {
  return Math.max(0, clip.trimStart + (t - clip.startTime) * clipSpeed(clip));
}

/** The clips on the same track as `clip`, in time order */
export function sameTrackClips(project: ProjectData, clip: VideoClipItem): VideoClipItem[] {
  return project.videoClips
    .filter((c) => isOverlayClip(c) === isOverlayClip(clip))
    .sort((a, b) => a.startTime - b.startTime);
}

const endOf = (clip: VideoClipItem) => clip.startTime + clip.duration;

/** The clip that ends where `clip` starts, on the same track */
function clipBefore(project: ProjectData, clip: VideoClipItem): VideoClipItem | undefined {
  return sameTrackClips(project, clip).find((c) => c !== clip && Math.abs(endOf(c) - clip.startTime) < ADJACENT_SEC);
}

/** The clip that starts where `clip` ends, on the same track */
function clipAfter(project: ProjectData, clip: VideoClipItem): VideoClipItem | undefined {
  return sameTrackClips(project, clip).find((c) => c !== clip && Math.abs(c.startTime - endOf(clip)) < ADJACENT_SEC);
}

type Transition = { type: TransitionType; duration: number };

/**
 * The transition from `before` into `clip`, centred on the cut. It is never longer than either
 * clip, so it cannot run into the transition at the clip's other end.
 */
function cutTransition(before: VideoClipItem, clip: VideoClipItem): Transition | null {
  const tr = clip.transition;
  if (!tr || tr.duration <= 0) return null;
  return { type: tr.type, duration: Math.min(tr.duration, before.duration, clip.duration) };
}

/** A transition where nothing comes before the clip: it fades in from black (or white) */
function openingTransition(clip: VideoClipItem): Transition | null {
  const tr = clip.transition;
  if (!tr || tr.duration <= 0) return null;
  return { type: tr.type, duration: Math.min(tr.duration, clip.duration) };
}

/** A B-roll clip dissolves in at its start and out at its end */
function overlayFadeSec(clip: VideoClipItem): number {
  const tr = clip.transition;
  return tr && tr.duration > 0 ? Math.min(tr.duration, clip.duration / 2) : 0;
}

const dipColor = (type: TransitionType): 'black' | 'white' => (type === 'fade_white' ? 'white' : 'black');

function layer(clip: VideoClipItem, t: number, alpha: number): PictureLayer {
  return {
    clip,
    sourceTime: sourceTimeAt(clip, t),
    progress: clamp01((t - clip.startTime) / (clip.duration || 1)),
    alpha: clamp01(alpha),
  };
}

/** Picture at `t` while `out` hands over to `into` (p goes 0 to 1 across the transition) */
function across(out: VideoClipItem, into: VideoClipItem, tr: Transition, t: number): Pick<Picture, 'main' | 'dip'> {
  const cut = into.startTime;
  const p = clamp01((t - (cut - tr.duration / 2)) / tr.duration);
  if (tr.type === 'dissolve') {
    return { main: [layer(out, t, 1), layer(into, t, p)], dip: null };
  }
  // A dip: the outgoing clip fades to the colour by the cut, the incoming one fades in from it
  return t < cut
    ? { main: [layer(out, t, 1)], dip: { color: dipColor(tr.type), alpha: p * 2 } }
    : { main: [layer(into, t, 1)], dip: { color: dipColor(tr.type), alpha: (1 - p) * 2 } };
}

/** Whether `t` falls on the opening or ending card (no clips are shown there) */
export function isOnTitleCard(project: ProjectData, t: number): boolean {
  const { opDuration, edDuration } = project.branding;
  return (opDuration > 0 && t < opDuration) || (edDuration > 0 && t >= project.duration - edDuration);
}

/** What the picture is made of at timeline time `t` */
export function pictureAt(project: ProjectData, t: number): Picture {
  const picture: Picture = { main: [], overlay: null, dip: null };
  if (isOnTitleCard(project, t) || project.mutedTracks?.video === true) return picture;

  const isAt = (c: VideoClipItem) => t >= c.startTime && t < endOf(c);
  const active = project.videoClips.find((c) => !isOverlayClip(c) && isAt(c));
  if (active) {
    const next = clipAfter(project, active);
    const nextTr = next && cutTransition(active, next);
    const prev = clipBefore(project, active);
    const ownTr = prev ? cutTransition(prev, active) : openingTransition(active);

    if (next && nextTr && t >= next.startTime - nextTr.duration / 2) {
      Object.assign(picture, across(active, next, nextTr, t));
    } else if (prev && ownTr && t < active.startTime + ownTr.duration / 2) {
      Object.assign(picture, across(prev, active, ownTr, t));
    } else if (!prev && ownTr && t < active.startTime + ownTr.duration) {
      picture.main = [layer(active, t, 1)];
      picture.dip = { color: dipColor(ownTr.type), alpha: 1 - (t - active.startTime) / ownTr.duration };
    } else {
      picture.main = [layer(active, t, 1)];
    }
  }

  const overlay = project.videoClips.find((c) => isOverlayClip(c) && isAt(c));
  if (overlay) {
    const fade = overlayFadeSec(overlay);
    const alpha = fade > 0 ? Math.min(1, (t - overlay.startTime) / fade, (endOf(overlay) - t) / fade) : 1;
    picture.overlay = layer(overlay, t, alpha);
  }
  return picture;
}

/** Every clip drawn at `t`, bottom first */
export const pictureLayers = (picture: Picture): PictureLayer[] =>
  picture.overlay ? [...picture.main, picture.overlay] : picture.main;

export interface ClipSoundSpan {
  /** Timeline seconds the clip's sound starts and stops */
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
  /** Seconds into the source file at `start` */
  sourceOffset: number;
}

/**
 * When a video clip's own sound plays. A dissolve also crossfades the sound of the two clips
 * (each runs half the transition past its cut), a dip fades the sound out and back in with the
 * picture, and a B-roll clip fades its sound in and out with its picture.
 */
export function clipSoundSpan(project: ProjectData, clip: VideoClipItem): ClipSoundSpan {
  let start = clip.startTime;
  let end = endOf(clip);
  let fadeIn = CUT_FADE_IN_SEC;
  let fadeOut = CUT_FADE_OUT_SEC;

  if (isOverlayClip(clip)) {
    const fade = overlayFadeSec(clip);
    if (fade > 0) fadeIn = fadeOut = fade;
  } else {
    const prev = clipBefore(project, clip);
    const inTr = prev ? cutTransition(prev, clip) : openingTransition(clip);
    if (inTr && prev && inTr.type === 'dissolve') {
      start -= inTr.duration / 2;
      fadeIn = inTr.duration;
    } else if (inTr) {
      fadeIn = prev ? inTr.duration / 2 : inTr.duration;
    }

    const next = clipAfter(project, clip);
    const outTr = next && cutTransition(clip, next);
    if (outTr && outTr.type === 'dissolve') {
      end += outTr.duration / 2;
      fadeOut = outTr.duration;
    } else if (outTr) {
      fadeOut = outTr.duration / 2;
    }
  }

  // The source has nothing before its first second: start the sound later rather than early
  const speed = clipSpeed(clip);
  const rawOffset = clip.trimStart + (start - clip.startTime) * speed;
  if (rawOffset < 0) {
    start -= rawOffset / speed;
    fadeIn = Math.min(fadeIn, end - start);
  }
  return { start, end, fadeIn, fadeOut, sourceOffset: Math.max(0, rawOffset) };
}

/** Volume multiplier (0 to 1) of a clip's sound at `t` from its fades; 0 outside its span */
export function soundEnvelopeAt(span: ClipSoundSpan, t: number): number {
  if (t < span.start || t >= span.end) return 0;
  let gain = 1;
  if (span.fadeIn > 0) gain = Math.min(gain, (t - span.start) / span.fadeIn);
  if (span.fadeOut > 0) gain = Math.min(gain, (span.end - t) / span.fadeOut);
  return clamp01(gain);
}

/**
 * A clip's colour correction as Canvas operations: `filter` (CSS filter functions for brightness,
 * contrast and saturation) and `tint` (a colour to multiply the picture by, which shifts its
 * white balance warmer or cooler). Null when the clip is left as it is.
 */
export function colorAdjustment(clip: VideoClipItem): { filter: string | null; tint: string | null } {
  const c = clip.color;
  const parts: string[] = [];
  if (c?.brightness) parts.push(`brightness(${1 + c.brightness / 100})`);
  if (c?.contrast) parts.push(`contrast(${1 + c.contrast / 100})`);
  if (c?.saturation) parts.push(`saturate(${1 + c.saturation / 100})`);

  let tint: string | null = null;
  const warmth = Math.max(-1, Math.min(1, (c?.temperature ?? 0) / 50));
  if (warmth !== 0) {
    // Warmer: less blue (and a touch less green); cooler: less red
    const a = Math.abs(warmth);
    const [r, g, b] = warmth > 0 ? [1, 1 - 0.06 * a, 1 - 0.22 * a] : [1 - 0.22 * a, 1 - 0.06 * a, 1];
    tint = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }
  return { filter: parts.length > 0 ? parts.join(' ') : null, tint };
}
