/**
 * Timeline editing operations (pure functions on ProjectData)
 */
import { AudioTrackItem, ProjectData, VideoClipItem } from '../types';
import { clipSpeed, isOverlayClip, MAX_SPEED, MIN_SPEED, sameTrackClips } from './composition';

// A split must leave at least this many seconds on each side
const MIN_PIECE_SEC = 0.3;
// A BGM / ambience track that ended this close to the old end of the video ran to the end
const END_TOLERANCE_SEC = 0.05;
// Shortening the video never leaves a BGM / ambience track with less than this inside it
const MIN_BED_SEC = 1;

const round = (n: number) => Math.round(n * 100) / 100;

/** BGM and ambience lie under the whole video, so they are fitted to its length rather than setting it */
const isBedTrack = (track: AudioTrackItem) => track.type === 'bgm' || track.type === 'ambience';

const endOf = (items: { startTime: number; duration: number }[]) =>
  items.reduce((end, item) => Math.max(end, item.startTime + item.duration), 0);

/**
 * Fit the length of the video to what is on the timeline: the opening card, the pictures,
 * then the ending card right after the last picture, so the video never ends on an empty stretch.
 * Telops, access cards and narration may run on into the ending card; if one runs past it, the
 * video gets longer instead of cutting it off. BGM and ambience never make the video longer:
 * they are cut at its end, and ones that ran to the old end (`previousDuration`) run to the new one.
 * Returns `project` itself when nothing changes.
 */
export function fitDurationToContent(project: ProjectData, previousDuration = project.duration): ProjectData {
  const op = Math.max(0, project.branding.opDuration);
  const ed = Math.max(0, project.branding.edDuration);
  const pictureEnd = Math.max(op, endOf(project.videoClips));
  const duration = round(
    Math.max(
      pictureEnd + ed,
      endOf(project.subtitles),
      endOf(project.accessCards),
      endOf(project.audioTracks.filter((t) => !isBedTrack(t))),
      ...project.audioTracks.filter(isBedTrack).map((t) => t.startTime + MIN_BED_SEC)
    )
  );

  let changedTracks = false;
  const audioTracks = project.audioTracks.map((track) => {
    if (!isBedTrack(track)) return track;
    const end = track.startTime + track.duration;
    const newEnd = Math.abs(end - previousDuration) < END_TOLERANCE_SEC ? duration : Math.min(end, duration);
    if (Math.abs(newEnd - end) < 0.005) return track;
    changedTracks = true;
    return { ...track, duration: round(newEnd - track.startTime) };
  });

  if (duration === project.duration && !changedTracks) return project;
  return { ...project, duration, audioTracks: changedTracks ? audioTracks : project.audioTracks };
}

/**
 * Split the item with `itemId` (video/photo clip, telop, or audio clip) at `time`.
 * Returns the updated project, or null when the item is not under `time`
 * or `time` is too close to one of its ends.
 */
export function splitItemAtTime(project: ProjectData, itemId: string, time: number): ProjectData | null {
  const isSplittable = (item: { startTime: number; duration: number }) =>
    time > item.startTime + MIN_PIECE_SEC && time < item.startTime + item.duration - MIN_PIECE_SEC;
  const newId = (prefix: string) => `${prefix}_${Date.now()}_b`;
  const updatedAt = new Date().toISOString();

  const clip = project.videoClips.find((c) => c.id === itemId);
  if (clip) {
    if (!isSplittable(clip)) return null;
    const first = time - clip.startTime;
    const pieceA = { ...clip, duration: round(first) };
    const pieceB = {
      ...clip,
      id: newId('clip'),
      name: `${clip.name} (分割)`,
      startTime: round(time),
      duration: round(clip.duration - first),
      trimStart: (clip.trimStart || 0) + first * clipSpeed(clip),
      // The two pieces continue each other: a main-track split is a plain cut
      transition: isOverlayClip(clip) ? clip.transition : undefined,
    };
    return {
      ...project,
      videoClips: project.videoClips.flatMap((c) => (c.id === clip.id ? [pieceA, pieceB] : [c])),
      updatedAt,
    };
  }

  const sub = project.subtitles.find((s) => s.id === itemId);
  if (sub) {
    if (!isSplittable(sub)) return null;
    const first = time - sub.startTime;
    const pieceA = { ...sub, duration: round(first) };
    const pieceB = { ...sub, id: newId('sub'), startTime: round(time), duration: round(sub.duration - first) };
    return {
      ...project,
      subtitles: project.subtitles.flatMap((s) => (s.id === sub.id ? [pieceA, pieceB] : [s])),
      updatedAt,
    };
  }

  const audio = project.audioTracks.find((a) => a.id === itemId);
  if (audio) {
    if (!isSplittable(audio)) return null;
    const first = time - audio.startTime;
    const pieceA = { ...audio, duration: round(first) };
    const pieceB = {
      ...audio,
      id: newId('audio'),
      name: `${audio.name} (分割)`,
      startTime: round(time),
      duration: round(audio.duration - first),
      trimStart: (audio.trimStart || 0) + first,
    };
    return {
      ...project,
      audioTracks: project.audioTracks.flatMap((a) => (a.id === audio.id ? [pieceA, pieceB] : [a])),
      updatedAt,
    };
  }

  return null;
}

// A clip is never trimmed or slowed down to shorter than this
const MIN_CLIP_SEC = 0.5;
// Items starting this close to a point count as starting at it
const SAME_TIME_SEC = 0.01;

export interface ClipEditLimits {
  /** Where the clip may start when moved: the end of the clip before it on its track */
  earliestStart: number;
  /** Where the clip may end when moved: the start of the clip after it on its track */
  latestEnd: number;
  /** Where its start may be trimmed back to (also limited by the start of a video's source) */
  earliestHead: number;
  /** Where its end may be trimmed out to (also limited by the end of a video's source) */
  latestTail: number;
}

/**
 * How far a clip can move or be trimmed: clips on one track never overlap, and a video never
 * shows more than its source file holds. A clip that already overlaps or runs past its source
 * (from an older project) keeps what it has but cannot grow further.
 */
export function clipEditLimits(project: ProjectData, clip: VideoClipItem): ClipEditLimits {
  const end = clip.startTime + clip.duration;
  const others = sameTrackClips(project, clip).filter((c) => c.id !== clip.id);
  const earliestStart = Math.min(
    clip.startTime,
    others.filter((c) => c.startTime < clip.startTime).reduce((m, c) => Math.max(m, c.startTime + c.duration), 0)
  );
  const latestEnd = Math.max(
    end,
    others.filter((c) => c.startTime >= clip.startTime).reduce((m, c) => Math.min(m, c.startTime), Infinity)
  );

  if (clip.type !== 'video') return { earliestStart, latestEnd, earliestHead: earliestStart, latestTail: latestEnd };
  const speed = clipSpeed(clip);
  const sourceStart = clip.startTime - clip.trimStart / speed;
  const sourceEnd = clip.sourceDuration ? clip.startTime + (clip.sourceDuration - clip.trimStart) / speed : Infinity;
  return {
    earliestStart,
    latestEnd,
    earliestHead: Math.min(clip.startTime, Math.max(earliestStart, sourceStart)),
    latestTail: Math.max(end, Math.min(latestEnd, sourceEnd)),
  };
}

/** How far a sound can be trimmed: not before the start of its file, and (unless it loops) not past its end */
export function audioEditLimits(track: AudioTrackItem): { earliestHead: number; latestTail: number } {
  const trimStart = track.trimStart || 0;
  const end = track.startTime + track.duration;
  const loops = isBedTrack(track);
  return {
    earliestHead: Math.min(track.startTime, Math.max(0, track.startTime - trimStart)),
    latestTail:
      !loops && track.sourceDuration ? Math.max(end, track.startTime + track.sourceDuration - trimStart) : Infinity,
  };
}

/**
 * Move everything that starts at or after `time` by `delta` seconds, closing (negative) or
 * opening up a stretch of the timeline: clips on both tracks, telops, access cards, sounds and
 * chapters. BGM and ambience under the whole video start before it and stay where they are.
 */
export function shiftTimelineFrom(project: ProjectData, time: number, delta: number): ProjectData {
  if (delta === 0) return project;
  const shift = <T extends { startTime: number }>(items: T[]): T[] =>
    items.map((item) => (item.startTime >= time - SAME_TIME_SEC ? { ...item, startTime: round(Math.max(0, item.startTime + delta)) } : item));
  return {
    ...project,
    videoClips: shift(project.videoClips),
    subtitles: shift(project.subtitles),
    accessCards: shift(project.accessCards),
    audioTracks: shift(project.audioTracks),
    chapters: project.chapters.map((ch) =>
      ch.timeSec >= time - SAME_TIME_SEC ? { ...ch, timeSec: Math.max(0, Math.round(ch.timeSec + delta)) } : ch
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Delete a clip. On the main track everything after it moves up to close the gap (a ripple
 * delete), so the video never shows an empty stretch; telops and sounds after it move along.
 * Removing a B-roll clip leaves the main track as it is.
 */
export function rippleDeleteClip(project: ProjectData, clipId: string): ProjectData {
  const clip = project.videoClips.find((c) => c.id === clipId);
  if (!clip) return project;
  const without = { ...project, videoClips: project.videoClips.filter((c) => c.id !== clipId), updatedAt: new Date().toISOString() };
  if (isOverlayClip(clip)) return without;
  return shiftTimelineFrom(without, clip.startTime + clip.duration, -clip.duration);
}

/**
 * Play a video clip faster or slower. It keeps showing the same part of its source, so it gets
 * shorter or longer: on the main track what follows moves with it; a B-roll clip is cut short
 * where the next B-roll clip begins.
 */
export function setClipSpeed(project: ProjectData, clipId: string, speed: number): ProjectData {
  const clip = project.videoClips.find((c) => c.id === clipId);
  if (!clip || clip.type !== 'video') return project;
  const newSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
  let duration = Math.max(MIN_CLIP_SEC, round((clip.duration * clipSpeed(clip)) / newSpeed));
  if (isOverlayClip(clip)) {
    duration = Math.min(duration, clipEditLimits(project, clip).latestEnd - clip.startTime);
  }
  const updated: VideoClipItem = { ...clip, speed: newSpeed === 1 ? undefined : newSpeed, duration };
  const replaced = {
    ...project,
    videoClips: project.videoClips.map((c) => (c.id === clipId ? updated : c)),
    updatedAt: new Date().toISOString(),
  };
  if (isOverlayClip(clip)) return replaced;
  // Shift what came after the clip's old end (the clip itself starts before it and stays put)
  return shiftTimelineFrom(replaced, clip.startTime + clip.duration, duration - clip.duration);
}

/**
 * Swap a clip with the one before (-1) or after (+1) it on the same track, keeping the space
 * between them. Returns null when there is no clip on that side.
 */
export function moveClipInOrder(project: ProjectData, clipId: string, direction: -1 | 1): ProjectData | null {
  const clip = project.videoClips.find((c) => c.id === clipId);
  if (!clip) return null;
  const track = sameTrackClips(project, clip);
  const index = track.findIndex((c) => c.id === clipId);
  const other = track[index + direction];
  if (!other) return null;
  const [first, second] = direction === 1 ? [clip, other] : [other, clip];
  const gap = second.startTime - (first.startTime + first.duration);
  const moved = new Map([
    [second.id, round(first.startTime)],
    [first.id, round(first.startTime + second.duration + gap)],
  ]);
  return {
    ...project,
    videoClips: project.videoClips.map((c) => (moved.has(c.id) ? { ...c, startTime: moved.get(c.id)! } : c)),
    updatedAt: new Date().toISOString(),
  };
}

/** Whether the stretch [start, start + duration) is free on a track (ignoring `exceptId`) */
function isFreeOn(project: ProjectData, overlay: boolean, start: number, duration: number, exceptId?: string) {
  return project.videoClips.every(
    (c) =>
      c.id === exceptId ||
      isOverlayClip(c) !== overlay ||
      c.startTime >= start + duration - SAME_TIME_SEC ||
      c.startTime + c.duration <= start + SAME_TIME_SEC
  );
}

/**
 * Move a clip between the main track and the B-roll track, at the same time.
 * Returns null when another clip already occupies that time on the other track.
 */
export function moveClipToTrack(project: ProjectData, clipId: string, track: 'main' | 'overlay'): ProjectData | null {
  const clip = project.videoClips.find((c) => c.id === clipId);
  if (!clip) return null;
  if (isOverlayClip(clip) === (track === 'overlay')) return project;
  if (!isFreeOn(project, track === 'overlay', clip.startTime, clip.duration, clip.id)) return null;
  return {
    ...project,
    videoClips: project.videoClips.map((c) =>
      c.id === clipId ? { ...c, track: track === 'overlay' ? ('overlay' as const) : undefined } : c
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Where a new B-roll clip can go at `time`: from there (or from the end of a B-roll clip already
 * under `time`) until the next B-roll clip, at most `duration` long. Null when there is no room.
 */
export function openOverlaySpan(project: ProjectData, time: number, duration: number): { start: number; duration: number } | null {
  const overlays = project.videoClips.filter(isOverlayClip).sort((a, b) => a.startTime - b.startTime);
  let start = time;
  for (const c of overlays) {
    if (start >= c.startTime && start < c.startTime + c.duration) start = c.startTime + c.duration;
  }
  const next = overlays.find((c) => c.startTime >= start + SAME_TIME_SEC);
  const room = (next ? next.startTime : Infinity) - start;
  const fitted = Math.min(duration, room);
  return fitted >= MIN_CLIP_SEC ? { start: round(start), duration: round(fitted) } : null;
}
