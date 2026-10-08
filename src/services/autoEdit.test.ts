import { describe, expect, it } from 'vitest';
import { planSegments, PlannedSegment } from './autoEdit';
import { QUALITY_STEP, VideoAnalysis } from './videoAnalysis';

function video(duration: number, parts: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    file: new File([], 'clip.mp4'),
    name: 'clip',
    duration,
    recordedAt: null,
    location: null,
    speechRanges: [],
    quality: new Array(Math.floor(duration / QUALITY_STEP)).fill(0.8),
    warnings: [],
    ...parts,
  };
}

const totalLength = (segments: PlannedSegment[]) => segments.reduce((sum, s) => sum + s.end - s.start, 0);

describe('planSegments', () => {
  it('keeps talking whole, even when it is longer than the target', () => {
    const segments = planSegments([video(60, { speechRanges: [[10, 40]] })], 10, 5);
    expect(segments).toEqual([{ video: 0, start: 10, end: 40, hasSpeech: true }]);
  });

  it('uses all the footage, minus the shaky first and last moments, when there is no more than the target', () => {
    const segments = planSegments([video(20)], 100, 5);
    expect(segments).toEqual([{ video: 0, start: 0.6, end: 19.4, hasSpeech: false }]);
  });

  it('joins talking and the scenery around it into one continuous shot', () => {
    const segments = planSegments([video(20, { speechRanges: [[5, 8]] })], 100, 5);
    expect(segments).toEqual([{ video: 0, start: 0.6, end: 19.4, hasSpeech: true }]);
  });

  it('fills the target with shots from every video, in recording order', () => {
    const segments = planSegments([video(60), video(60), video(60)], 30, 5);
    expect(totalLength(segments)).toBeCloseTo(30, 5);
    expect(new Set(segments.map((s) => s.video))).toEqual(new Set([0, 1, 2]));
    const order = segments.map((s) => s.video * 1000 + s.start);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('picks the steady moment and leaves out shaky footage', () => {
    // Steady only from 20 s to 26 s
    const quality = new Array(240).fill(0.1);
    for (let i = 20 / QUALITY_STEP; i < 26 / QUALITY_STEP; i++) quality[i] = 0.9;
    const [shot, ...rest] = planSegments([video(60, { quality })], 5, 5);

    expect(rest).toHaveLength(0);
    expect(shot.start).toBeGreaterThanOrEqual(20);
    expect(shot.end).toBeLessThanOrEqual(26);
    expect(shot.end - shot.start).toBeCloseTo(5, 5);
  });

  it('uses a short video whole, without trimming its edges', () => {
    const segments = planSegments([video(2.5), video(60)], 10, 5);
    expect(segments[0]).toEqual({ video: 0, start: 0, end: 2.5, hasSpeech: false });
    expect(totalLength(segments)).toBeCloseTo(10, 5);
  });

  it('leaves out a video shorter than a shot and fills the target from the others', () => {
    const segments = planSegments([video(1.5), video(60)], 10, 5);
    expect(segments.every((s) => s.video === 1)).toBe(true);
    expect(totalLength(segments)).toBeCloseTo(10, 5);
  });
});
