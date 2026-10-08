import { describe, expect, it } from 'vitest';
import { generateSRT, generateYouTubeDescription } from './srtExporter';
import { MultilingualSubtitleItem } from '../types';

const sub = (id: string, startTime: number, duration: number, ja: string, en = ''): MultilingualSubtitleItem => ({
  id,
  startTime,
  duration,
  category: 'commentary',
  text: { ja, en },
});

describe('generateSRT', () => {
  it('writes numbered entries in time order', () => {
    const srt = generateSRT([sub('b', 5, 2, '拝殿'), sub('a', 1.5, 2, '大鳥居')], 'ja');
    expect(srt).toBe('1\n00:00:01,500 --> 00:00:03,500\n大鳥居\n\n2\n00:00:05,000 --> 00:00:07,000\n拝殿\n');
  });

  it('writes hours and minutes', () => {
    expect(generateSRT([sub('a', 3725.25, 1, 'テロップ')], 'ja')).toContain('01:02:05,250 --> 01:02:06,250');
  });

  it('does not lose a millisecond to floating point (2.3 s is ,300 not ,299)', () => {
    expect(generateSRT([sub('a', 2.3, 1.1, 'テロップ')], 'ja')).toContain('00:00:02,300 --> 00:00:03,400');
  });

  it('falls back to Japanese when the English line is missing, and skips empty lines', () => {
    const srt = generateSRT([sub('a', 0, 1, '手水舎', ''), sub('b', 2, 1, '', ''), sub('c', 4, 1, '拝殿', 'Main hall')], 'en');
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,000\n手水舎\n\n2\n00:00:04,000 --> 00:00:05,000\nMain hall\n');
  });
});

describe('generateYouTubeDescription', () => {
  it('lists the chapters in time order as mm:ss', () => {
    const text = generateYouTubeDescription(
      [
        { id: '2', timeSec: 75.9, title: { ja: '拝殿', en: 'Main hall' } },
        { id: '1', timeSec: 0, title: { ja: 'はじめに', en: 'Intro' } },
      ],
      '戸隠神社'
    );
    expect(text).toContain('00:00 はじめに\n01:15 拝殿');
  });
});
