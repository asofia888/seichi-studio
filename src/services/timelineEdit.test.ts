import { describe, expect, it } from 'vitest';
import { splitItemAtTime } from './timelineEdit';
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
