import { describe, expect, it } from 'vitest';
import { makeProject } from '../test/makeProject';
import { historyReducer, createHistory } from './projectHistory';
import { InvalidProjectError, normalizeProject } from './projectSchema';
import { initialProjectData, iseProjectData, izumoProjectData } from './sampleData';

describe('normalizeProject', () => {
  it('leaves a complete project exactly as it is', () => {
    for (const project of [makeProject(), initialProjectData, izumoProjectData, iseProjectData]) {
      expect(normalizeProject(project)).toEqual(project);
    }
  });

  it('keeps every optional setting of clips and sounds', () => {
    const project = makeProject({
      vignette: 0.3,
      mutedTracks: { bgm: true, video: false },
      videoClips: [
        {
          id: 'c1',
          name: '参道',
          type: 'video',
          blobKey: 'file_1_2_a.mp4',
          startTime: 3,
          duration: 4,
          trimStart: 1,
          trimEnd: 5,
          sourceDuration: 20,
          volume: 0.5,
          speechRanges: [[1, 2.5]],
          track: 'overlay',
          speed: 2,
          transition: { type: 'fade_white', duration: 0.5 },
          color: { brightness: 10, contrast: -5, saturation: 0, temperature: 20 },
        },
        {
          id: 'c2',
          name: '鳥居',
          type: 'image',
          dataUrl: 'data:image/png;base64,AAAA',
          startTime: 7,
          duration: 8,
          trimStart: 0,
          trimEnd: 8,
          kenBurns: { enabled: false, preset: 'pan_left', scaleStart: 1, scaleEnd: 1.2, panX: 3, panY: -1, focusPoint: { x: 0.2, y: 0.8 } },
        },
      ],
      audioTracks: [
        {
          id: 'a1',
          name: 'BGM',
          type: 'bgm',
          startTime: 0,
          duration: 60,
          volume: 0.6,
          blobKey: 'file_3_4_bgm.mp3',
          waveform: [0.2, 1, 0.5],
          sourceDuration: 120,
          trimStart: 2,
          fadeInSec: 1,
          fadeOutSec: 0,
          autoDucking: { enabled: false, duckVolume: 0.3, fadeSec: 0.5 },
        },
      ],
    });
    expect(normalizeProject(project)).toEqual(project);
  });

  it('refuses data that is not a project', () => {
    for (const notAProject of [null, 'text', 42, [], {}, { title: 'タイトルだけ' }, { name: 'package', version: '1.0.0' }]) {
      expect(() => normalizeProject(notAProject)).toThrow(InvalidProjectError);
    }
  });

  it('fills in everything a partial project lacks', () => {
    const project = normalizeProject({ title: '途中まで', videoClips: [], audioTracks: [] });
    expect(project).toMatchObject({
      title: '途中まで',
      aspectRatio: '16:9',
      fps: 30,
      subtitles: [],
      accessCards: [],
      chapters: [],
      glossary: [],
      branding: { opDuration: 0, edDuration: 0, fontFamily: 'Shippori Mincho', opTitle: { ja: '', en: '' } },
    });
  });

  it('gives the editor a project it can work on, where the raw data would have stopped it', () => {
    const state = createHistory(makeProject());
    const raw = { title: '途中まで', videoClips: [], audioTracks: [] };
    expect(() => historyReducer(state, { type: 'update', update: raw as never, at: 1 })).toThrow();

    const next = historyReducer(state, { type: 'update', update: normalizeProject(raw), at: 1 });
    expect(next.present.duration).toBe(0);
  });

  it('leaves out timeline items that cannot be placed, and says how many', () => {
    const report = { dropped: 0 };
    const project = normalizeProject(
      {
        ...makeProject(),
        videoClips: [
          { id: 'ok', name: '写真', type: 'image', startTime: 3, duration: 5, trimStart: 0, trimEnd: 5 },
          { id: 'no-length', name: '壊れ', type: 'image', startTime: 'abc', duration: null },
          { id: 'unknown-kind', name: '壊れ', type: 'hologram', startTime: 0, duration: 5 },
          'not even an object',
        ],
        subtitles: [{ id: 's', startTime: 1, duration: -2, category: 'commentary', text: { ja: 'あ', en: 'a' } }],
        audioTracks: [{ id: 'n', name: '声', type: 'narration', startTime: 0, duration: 0, volume: 1 }],
      },
      report
    );
    expect(project.videoClips.map((c) => c.id)).toEqual(['ok']);
    expect(project.subtitles).toEqual([]);
    expect(project.audioTracks).toEqual([]);
    expect(report.dropped).toBe(5);
  });

  it('never lets a number that is not a number through', () => {
    const project = normalizeProject({
      ...makeProject(),
      fps: 'fast',
      duration: NaN,
      vignette: 7,
      videoClips: [{ id: 'c', name: 'a', type: 'video', startTime: 'abc', duration: '5', trimStart: Infinity, volume: 3, speed: -1 }],
      audioTracks: [{ id: 'a', name: 'b', type: 'bgm', startTime: -4, duration: 10, volume: 'loud', waveform: [0.5, 'x', 2] }],
      chapters: [{ id: 'ch', timeSec: null, title: '見出し' }],
    });
    expect(project.fps).toBe(30);
    expect(project.duration).toBe(0);
    expect(project.vignette).toBe(1);
    expect(project.videoClips[0]).toEqual({
      id: 'c',
      name: 'a',
      type: 'video',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 5,
      volume: 1,
    });
    expect(project.audioTracks[0]).toMatchObject({ startTime: 0, volume: 1, waveform: [0.5, 1] });
    expect(project.chapters[0]).toEqual({ id: 'ch', timeSec: 0, title: { ja: '見出し', en: '' } });
  });

  it('gives items without an id, or with one already taken, an id of their own', () => {
    const clip = { name: '写真', type: 'image', startTime: 0, duration: 5 };
    const project = normalizeProject({ ...makeProject(), videoClips: [{ ...clip, id: 'same' }, { ...clip, id: 'same' }, clip] });
    const ids = project.videoClips.map((c) => c.id);
    expect(ids[0]).toBe('same');
    expect(new Set(ids).size).toBe(3);
  });

  it('drops what does not belong in a project file (e.g. an API key saved by an early version)', () => {
    const project = normalizeProject({ ...makeProject(), claudeApiKey: 'sk-ant-secret' });
    expect(JSON.stringify(project)).not.toContain('sk-ant-secret');
  });
});
