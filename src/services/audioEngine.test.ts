import { describe, expect, it } from 'vitest';
import { duckGainAt, getSpeechSpans, mergeSpans } from './audioEngine';
import { VideoClipItem } from '../types';

describe('duckGainAt', () => {
  const spans: [number, number][] = [[5, 8]];

  it('ramps the BGM down before speech, holds it under the speech and ramps it back after', () => {
    expect(duckGainAt(spans, 4, 0.2, 0.5)).toBe(1);
    expect(duckGainAt(spans, 4.75, 0.2, 0.5)).toBeCloseTo(0.6);
    expect(duckGainAt(spans, 6, 0.2, 0.5)).toBe(0.2);
    expect(duckGainAt(spans, 8.25, 0.2, 0.5)).toBeCloseTo(0.6);
    expect(duckGainAt(spans, 9, 0.2, 0.5)).toBe(1);
  });

  it('starts ducking at once for speech at the very start', () => {
    expect(duckGainAt([[0, 2]], 0, 0.3, 0.5)).toBe(0.3);
  });
});

describe('mergeSpans', () => {
  it('joins speech with gaps too short for the BGM to come back up', () => {
    expect(mergeSpans([[6, 7], [1, 2], [2.5, 3]], 1)).toEqual([[1, 3], [6, 7]]);
  });
});

describe('getSpeechSpans', () => {
  it('maps talking in a sped-up clip onto the timeline', () => {
    const clip: VideoClipItem = {
      id: 'v',
      name: 'v',
      type: 'video',
      dataUrl: 'blob:v',
      startTime: 10,
      duration: 5,
      trimStart: 2,
      trimEnd: 12,
      speed: 2,
      speechRanges: [[4, 8]],
    };
    expect(getSpeechSpans([], [clip])).toEqual([[11, 13]]);
  });
});
