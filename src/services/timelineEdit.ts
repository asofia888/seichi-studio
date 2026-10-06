/**
 * Timeline editing operations (pure functions on ProjectData)
 */
import { ProjectData } from '../types';

// A split must leave at least this many seconds on each side
const MIN_PIECE_SEC = 0.3;

const round = (n: number) => Math.round(n * 100) / 100;

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
      trimStart: (clip.trimStart || 0) + first,
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
