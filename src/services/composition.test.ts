import { describe, expect, it } from 'vitest';
import { clipSoundSpan, colorAdjustment, pictureAt, soundEnvelopeAt, sourceTimeAt } from './composition';
import { makeProject } from '../test/makeProject';
import { VideoClipItem } from '../types';

const video = (id: string, startTime: number, duration: number, parts: Partial<VideoClipItem> = {}): VideoClipItem => ({
  id,
  name: id,
  type: 'video',
  dataUrl: `blob:${id}`,
  startTime,
  duration,
  trimStart: 10,
  trimEnd: 10 + duration,
  ...parts,
});

// OP 3 s, then A 3-9 s and B 9-15 s back to back, ED 3 s
const project = (b: Partial<VideoClipItem> = {}, extra: VideoClipItem[] = []) =>
  makeProject({ duration: 18, videoClips: [video('A', 3, 6), video('B', 9, 6, b), ...extra] });
const ids = (t: number, p = project({ transition: { type: 'dissolve', duration: 2 } })) =>
  pictureAt(p, t).main.map((l) => [l.clip.id, Math.round(l.alpha * 100) / 100]);

describe('pictureAt', () => {
  it('shows one clip at a plain cut', () => {
    expect(ids(8.9, project())).toEqual([['A', 1]]);
    expect(ids(9, project())).toEqual([['B', 1]]);
  });

  it('dissolves across the cut, half before it and half after', () => {
    expect(ids(7.9)).toEqual([['A', 1]]);
    expect(ids(8)).toEqual([['A', 1], ['B', 0]]);
    expect(ids(9)).toEqual([['A', 1], ['B', 0.5]]);
    expect(ids(9.5)).toEqual([['A', 1], ['B', 0.75]]);
    expect(ids(10)).toEqual([['B', 1]]);
  });

  it('keeps both clips moving during a dissolve: the outgoing one past its out point, the incoming one before its in point', () => {
    const [a, b] = pictureAt(project({ transition: { type: 'dissolve', duration: 2 } }), 9.5).main;
    expect(a.sourceTime).toBeCloseTo(16.5); // A ends at source 16 s and carries on
    expect(b.sourceTime).toBeCloseTo(10.5);
    const [, early] = pictureAt(project({ transition: { type: 'dissolve', duration: 2 } }), 8.5).main;
    expect(early.sourceTime).toBeCloseTo(9.5); // B shows what was filmed just before its in point
  });

  it('dips to black: the outgoing clip fades out by the cut, the incoming one fades in after it', () => {
    const p = project({ transition: { type: 'fade_black', duration: 2 } });
    expect(pictureAt(p, 8.5)).toMatchObject({ main: [{ clip: { id: 'A' } }], dip: { color: 'black', alpha: 0.5 } });
    expect(pictureAt(p, 9)).toMatchObject({ main: [{ clip: { id: 'B' } }], dip: { color: 'black', alpha: 1 } });
    expect(pictureAt(p, 9.5).dip!.alpha).toBeCloseTo(0.5);
    expect(pictureAt(p, 10.1).dip).toBeNull();
  });

  it('fades the first clip in from black when nothing comes before it', () => {
    const p = makeProject({ videoClips: [video('A', 3, 6, { transition: { type: 'dissolve', duration: 1 } })] });
    expect(pictureAt(p, 3.25).dip).toEqual({ color: 'black', alpha: 0.75 });
    expect(pictureAt(p, 4).dip).toBeNull();
  });

  it('never lets a transition run longer than the clips it joins', () => {
    const p = makeProject({
      videoClips: [video('A', 3, 1), video('B', 4, 6, { transition: { type: 'dissolve', duration: 4 } })],
    });
    expect(pictureAt(p, 3.4).main.map((l) => l.clip.id)).toEqual(['A']); // a 1 s dissolve starts at 3.5 s
    expect(pictureAt(p, 3.6).main.map((l) => l.clip.id)).toEqual(['A', 'B']);
  });

  it('lays B-roll over the main clip, easing it in and out', () => {
    const broll = video('R', 10, 4, { track: 'overlay', transition: { type: 'dissolve', duration: 1 } });
    const p = project({}, [broll]);
    expect(pictureAt(p, 9.9).overlay).toBeNull();
    expect(pictureAt(p, 10.5)).toMatchObject({ main: [{ clip: { id: 'B' } }], overlay: { clip: { id: 'R' }, alpha: 0.5 } });
    expect(pictureAt(p, 12).overlay!.alpha).toBe(1);
    expect(pictureAt(p, 13.75).overlay!.alpha).toBeCloseTo(0.25);
  });

  it('shows nothing on the opening and ending cards or with the video track hidden', () => {
    expect(ids(1, project()).length).toBe(0);
    expect(ids(16, project()).length).toBe(0);
    expect(pictureAt({ ...project(), mutedTracks: { video: true } }, 5).main).toEqual([]);
  });
});

describe('sourceTimeAt', () => {
  it('moves through the source faster or slower with the clip speed', () => {
    expect(sourceTimeAt(video('A', 3, 6, { speed: 2 }), 5)).toBe(14);
    expect(sourceTimeAt(video('A', 3, 6, { speed: 0.5 }), 5)).toBe(11);
  });
});

describe('clipSoundSpan', () => {
  it('crossfades the sound of two clips joined by a dissolve', () => {
    const p = project({ transition: { type: 'dissolve', duration: 2 } });
    expect(clipSoundSpan(p, p.videoClips[0])).toMatchObject({ start: 3, end: 10, fadeOut: 2 });
    expect(clipSoundSpan(p, p.videoClips[1])).toMatchObject({ start: 8, end: 15, fadeIn: 2, sourceOffset: 9 });
  });

  it('fades the sound out and back in with a dip', () => {
    const p = project({ transition: { type: 'fade_white', duration: 2 } });
    expect(clipSoundSpan(p, p.videoClips[0])).toMatchObject({ end: 9, fadeOut: 1 });
    expect(clipSoundSpan(p, p.videoClips[1])).toMatchObject({ start: 9, fadeIn: 1 });
  });

  it('starts the sound later when the source has nothing before the clip', () => {
    const p = project({ trimStart: 0.4, transition: { type: 'dissolve', duration: 2 } });
    expect(clipSoundSpan(p, p.videoClips[1])).toMatchObject({ start: 8.6, sourceOffset: 0 });
  });

  it('gives a volume envelope that follows the fades', () => {
    const span = { start: 8, end: 15, fadeIn: 2, fadeOut: 0.1, sourceOffset: 9 };
    expect(soundEnvelopeAt(span, 7.9)).toBe(0);
    expect(soundEnvelopeAt(span, 9)).toBe(0.5);
    expect(soundEnvelopeAt(span, 12)).toBe(1);
    expect(soundEnvelopeAt(span, 15)).toBe(0);
  });
});

describe('colorAdjustment', () => {
  it('leaves an uncorrected clip as it is', () => {
    expect(colorAdjustment(video('A', 0, 1))).toEqual({ filter: null, tint: null });
  });

  it('turns the sliders into canvas filters and a white-balance tint', () => {
    const warm = colorAdjustment(video('A', 0, 1, { color: { brightness: 20, contrast: -10, saturation: 0, temperature: 50 } }));
    expect(warm.filter).toBe('brightness(1.2) contrast(0.9)');
    expect(warm.tint).toBe('rgb(255, 240, 199)'); // less blue
    const cool = colorAdjustment(video('A', 0, 1, { color: { brightness: 0, contrast: 0, saturation: 0, temperature: -50 } }));
    expect(cool.tint).toBe('rgb(199, 240, 255)'); // less red
  });
});
