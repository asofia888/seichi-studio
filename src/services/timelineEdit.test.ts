import { describe, expect, it } from 'vitest';
import {
  clipEditLimits,
  fitDurationToContent,
  moveClipInOrder,
  moveClipToTrack,
  nudgeItem,
  openOverlaySpan,
  resizeItem,
  rippleDeleteClip,
  setClipSpeed,
  splitItemAtTime,
} from './timelineEdit';
import { shrinePresets } from './sampleData';
import { makeProject } from '../test/makeProject';
import { AudioTrackItem, MultilingualSubtitleItem, VideoClipItem } from '../types';

const clip: VideoClipItem = {
  id: 'clip1',
  name: '参道',
  type: 'video',
  startTime: 10,
  duration: 8,
  trimStart: 2,
  trimEnd: 10,
};
const subtitle: MultilingualSubtitleItem = {
  id: 'sub1',
  startTime: 4,
  duration: 6,
  category: 'commentary',
  text: { ja: '静かな参道', en: 'A quiet approach' },
};
const narration: AudioTrackItem = {
  id: 'audio1',
  name: '録音',
  type: 'narration',
  startTime: 20,
  duration: 10,
  volume: 1,
  trimStart: 1,
};
const project = makeProject({ videoClips: [clip], subtitles: [subtitle], audioTracks: [narration] });

describe('splitItemAtTime', () => {
  it('splits a video clip so the second piece continues where the first stops in the source', () => {
    const [a, b] = splitItemAtTime(project, 'clip1', 13)!.videoClips;
    expect(a).toMatchObject({ id: 'clip1', startTime: 10, duration: 3, trimStart: 2 });
    expect(b).toMatchObject({ startTime: 13, duration: 5, trimStart: 5 });
    expect(b.id).not.toBe('clip1');
  });

  it('splits a telop into two with the same text', () => {
    const [a, b] = splitItemAtTime(project, 'sub1', 6.5)!.subtitles;
    expect(a).toMatchObject({ startTime: 4, duration: 2.5, text: subtitle.text });
    expect(b).toMatchObject({ startTime: 6.5, duration: 3.5, text: subtitle.text });
  });

  it('splits an audio clip and offsets the second piece in the sound file', () => {
    const [a, b] = splitItemAtTime(project, 'audio1', 24)!.audioTracks;
    expect(a).toMatchObject({ startTime: 20, duration: 4, trimStart: 1 });
    expect(b).toMatchObject({ startTime: 24, duration: 6, trimStart: 5 });
  });

  it('leaves the other items as they were', () => {
    const updated = splitItemAtTime(project, 'clip1', 13)!;
    expect(updated.subtitles).toBe(project.subtitles);
    expect(updated.audioTracks).toBe(project.audioTracks);
  });

  it('refuses when the playhead is not over the item or too close to an end', () => {
    expect(splitItemAtTime(project, 'clip1', 5)).toBeNull();
    expect(splitItemAtTime(project, 'clip1', 10.1)).toBeNull();
    expect(splitItemAtTime(project, 'clip1', 17.9)).toBeNull();
    expect(splitItemAtTime(project, 'missing', 13)).toBeNull();
  });
});

describe('fitDurationToContent', () => {
  // OP 3 s, ED 3 s; photos from 3 s to 20 s
  const photo = (id: string, startTime: number, duration: number): VideoClipItem => ({
    id,
    name: id,
    type: 'image',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: duration,
  });
  const bgm: AudioTrackItem = { id: 'bgm', name: 'BGM', type: 'bgm', startTime: 0, duration: 23, volume: 0.6 };
  const base = makeProject({
    duration: 23,
    videoClips: [photo('a', 3, 9), photo('b', 12, 8)],
    audioTracks: [bgm],
  });

  it('leaves a project that already ends right after its ending card as it is', () => {
    expect(fitDurationToContent(base)).toBe(base);
  });

  it('shortens the video when its last picture is deleted, and the BGM that ran to the end follows', () => {
    const edited = { ...base, videoClips: [base.videoClips[0]] };
    const fitted = fitDurationToContent(edited, base.duration);
    expect(fitted.duration).toBe(15); // picture ends at 12, then the 3 s ending card
    expect(fitted.audioTracks[0].duration).toBe(15);
  });

  it('makes the video longer when a picture is added, and the BGM that ran to the end follows', () => {
    const edited = { ...base, videoClips: [...base.videoClips, photo('c', 20, 10)] };
    const fitted = fitDurationToContent(edited, base.duration);
    expect(fitted.duration).toBe(33);
    expect(fitted.audioTracks[0].duration).toBe(33);
  });

  it('lets a telop or narration run into the ending card, and lengthens the video only past it', () => {
    const into = { ...subtitle, startTime: 18, duration: 4 }; // ends at 22, inside the ED (20-23)
    expect(fitDurationToContent({ ...base, subtitles: [into] }).duration).toBe(23);

    const past: AudioTrackItem = { ...narration, startTime: 19, duration: 6 }; // ends at 25
    expect(fitDurationToContent({ ...base, audioTracks: [bgm, past] }).duration).toBe(25);
  });

  it('never lets BGM make the video longer, and cuts a BGM that was stretched past the end', () => {
    const stretched = { ...base, audioTracks: [{ ...bgm, duration: 40 }] };
    const fitted = fitDurationToContent(stretched, base.duration);
    expect(fitted.duration).toBe(23);
    expect(fitted.audioTracks[0].duration).toBe(23);
  });

  it('keeps a shorter BGM as it is when the video grows', () => {
    const short = { ...base, audioTracks: [{ ...bgm, duration: 10 }] };
    const edited = { ...short, videoClips: [...short.videoClips, photo('c', 20, 10)] };
    expect(fitDurationToContent(edited, short.duration).audioTracks[0].duration).toBe(10);
  });

  it('is the opening and ending cards alone when nothing is placed', () => {
    expect(fitDurationToContent(makeProject()).duration).toBe(6);
  });

  it('leaves the bundled shrine presets unchanged', () => {
    for (const preset of shrinePresets) expect(fitDurationToContent(preset.data)).toBe(preset.data);
  });
});

describe('editing clips on a track', () => {
  const vid = (id: string, startTime: number, duration: number, parts: Partial<VideoClipItem> = {}): VideoClipItem => ({
    id,
    name: id,
    type: 'video',
    startTime,
    duration,
    trimStart: 2,
    trimEnd: 2 + duration,
    sourceDuration: 20,
    ...parts,
  });
  const telop: MultilingualSubtitleItem = { ...subtitle, id: 'late', startTime: 16, duration: 3 };
  // A 3-9, B 9-15, C 15-21 on the main track; R is B-roll over B
  const timeline = makeProject({
    videoClips: [vid('A', 3, 6), vid('B', 9, 6), vid('C', 15, 6), vid('R', 10, 3, { track: 'overlay' })],
    subtitles: [telop],
    audioTracks: [{ id: 'bgm', name: 'BGM', type: 'bgm', startTime: 0, duration: 24, volume: 0.5 }],
    chapters: [{ id: 'ch', timeSec: 15, title: { ja: '本殿', en: 'Main hall' } }],
  });
  const at = (p: typeof timeline, id: string) => p.videoClips.find((c) => c.id === id)!;

  it('keeps a clip between its neighbours and inside its source', () => {
    expect(clipEditLimits(timeline, at(timeline, 'B'))).toEqual({
      earliestStart: 9,
      latestEnd: 15,
      earliestHead: 9, // the clip before ends where B starts
      latestTail: 15,
    });
    const last = clipEditLimits(timeline, at(timeline, 'C'));
    expect(last.latestTail).toBe(15 + (20 - 2)); // only as far as the source goes
    expect(last.earliestStart).toBe(15);
    // B-roll only meets other B-roll
    expect(clipEditLimits(timeline, at(timeline, 'R'))).toMatchObject({ earliestStart: 0, latestEnd: Infinity });
  });

  it('closes the gap when a main-track clip is deleted, moving what follows along with it', () => {
    const p = rippleDeleteClip(timeline, 'B');
    expect(p.videoClips.map((c) => [c.id, c.startTime])).toEqual([['A', 3], ['C', 9], ['R', 10]]);
    expect(p.subtitles[0].startTime).toBe(10);
    expect(p.chapters[0].timeSec).toBe(9);
    expect(p.audioTracks[0].startTime).toBe(0); // the BGM under the whole video stays
  });

  it('leaves the main track alone when B-roll is deleted', () => {
    const p = rippleDeleteClip(timeline, 'R');
    expect(p.videoClips.map((c) => [c.id, c.startTime])).toEqual([['A', 3], ['B', 9], ['C', 15]]);
  });

  it('changes the length with the speed and moves what follows', () => {
    const p = setClipSpeed(timeline, 'B', 2);
    expect(at(p, 'B')).toMatchObject({ speed: 2, duration: 3 });
    expect(at(p, 'C').startTime).toBe(12);
    expect(p.subtitles[0].startTime).toBe(13);
    const back = setClipSpeed(p, 'B', 1);
    expect(at(back, 'B').speed).toBeUndefined();
    expect(at(back, 'C').startTime).toBe(15);
  });

  it('swaps a clip with its neighbour on the same track', () => {
    const p = moveClipInOrder(timeline, 'B', -1)!;
    expect([at(p, 'B').startTime, at(p, 'A').startTime]).toEqual([3, 9]);
    expect(moveClipInOrder(timeline, 'A', -1)).toBeNull();
  });

  it('moves a clip to the B-roll track only where that track is free', () => {
    expect(moveClipToTrack(timeline, 'B', 'overlay')).toBeNull(); // R is there
    const p = moveClipToTrack(timeline, 'C', 'overlay')!;
    expect(at(p, 'C').track).toBe('overlay');
  });

  it('finds room for new B-roll after the playhead, up to the next B-roll clip', () => {
    expect(openOverlaySpan(timeline, 5, 10)).toEqual({ start: 5, duration: 5 });
    expect(openOverlaySpan(timeline, 11, 2)).toEqual({ start: 13, duration: 2 }); // R is under the playhead
    expect(openOverlaySpan(timeline, 9.8, 4)).toBeNull(); // only 0.2 s before R
  });

  it('continues the source at the speed of the clip when splitting it', () => {
    const p = splitItemAtTime({ ...timeline, videoClips: [vid('S', 3, 6, { speed: 2, transition: { type: 'dissolve', duration: 1 } })] }, 'S', 5)!;
    expect(p.videoClips[1]).toMatchObject({ startTime: 5, trimStart: 6, transition: undefined });
    expect(p.videoClips[0].transition).toEqual({ type: 'dissolve', duration: 1 });
  });
});

describe('nudgeItem / resizeItem (moving and resizing with the keyboard)', () => {
  const photo = (id: string, startTime: number, duration: number): VideoClipItem => ({
    id,
    name: id,
    type: 'image',
    startTime,
    duration,
    trimStart: 0,
    trimEnd: duration,
  });
  // A 3-8 s, a gap, B 9-14 s
  const project = makeProject({
    duration: 20,
    videoClips: [photo('A', 3, 5), photo('B', 9, 5)],
    subtitles: [subtitle],
    audioTracks: [{ ...narration, startTime: 2, duration: 4, trimStart: 1, sourceDuration: 6 }],
  });
  const clipA = (p: ReturnType<typeof nudgeItem>) => p!.videoClips.find((c) => c.id === 'A')!;

  it('moves an item by the step, leaving everything else alone', () => {
    const moved = nudgeItem(project, 'subtitle', 'sub1', 0.1)!;
    expect(moved.subtitles[0]).toMatchObject({ startTime: 4.1, duration: 6 });
    expect(moved.videoClips).toBe(project.videoClips);
    expect(nudgeItem(project, 'audio', 'audio1', -0.1)!.audioTracks[0].startTime).toBe(1.9);
  });

  it('stops a clip at the clip beside it and at the start of the timeline', () => {
    expect(clipA(nudgeItem(project, 'clip', 'A', 0.6)).startTime).toBe(3.6);
    expect(clipA(nudgeItem(project, 'clip', 'A', 5)).startTime, 'up against B').toBe(4);
    expect(clipA(nudgeItem(project, 'clip', 'A', -10)).startTime).toBe(0);
    const touching = nudgeItem(project, 'clip', 'A', 5)!;
    expect(nudgeItem(touching, 'clip', 'A', 0.1), 'nowhere to go').toBeNull();
    expect(nudgeItem({ ...project, subtitles: [{ ...subtitle, startTime: 0 }] }, 'subtitle', 'sub1', -0.1)).toBeNull();
  });

  it('keeps an item on the timeline', () => {
    expect(nudgeItem(project, 'subtitle', 'sub1', 100)!.subtitles[0].startTime).toBe(19.5);
  });

  it('makes an item longer or shorter at its end, never shorter than half a second', () => {
    expect(resizeItem(project, 'subtitle', 'sub1', 0.1)!.subtitles[0]).toMatchObject({ startTime: 4, duration: 6.1 });
    expect(resizeItem(project, 'subtitle', 'sub1', -100)!.subtitles[0].duration).toBe(0.5);
    const shortest = resizeItem(project, 'subtitle', 'sub1', -100)!;
    expect(resizeItem(shortest, 'subtitle', 'sub1', -0.1)).toBeNull();
  });

  it('does not grow a clip into the next one, or a sound past the end of its file', () => {
    expect(clipA(resizeItem(project, 'clip', 'A', 3)).duration, 'up to where B starts').toBe(6);
    // The file is 6 s and the first second is trimmed off: 5 s can be heard
    expect(resizeItem(project, 'audio', 'audio1', 3)!.audioTracks[0].duration).toBe(5);
  });

  it('is null for an item that does not exist', () => {
    expect(nudgeItem(project, 'clip', 'nobody', 1)).toBeNull();
    expect(resizeItem(project, 'audio', 'nobody', 1)).toBeNull();
  });
});
