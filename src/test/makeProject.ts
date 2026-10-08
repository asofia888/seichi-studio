import { ProjectData } from '../types';

/** A small empty project for tests; pass only the parts a test is about */
export function makeProject(parts: Partial<ProjectData> = {}): ProjectData {
  const blank = { ja: '', en: '' };
  return {
    id: 'test_project',
    title: 'テスト',
    aspectRatio: '16:9',
    fps: 30,
    duration: 60,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    branding: {
      channelName: '',
      opDuration: 3,
      edDuration: 3,
      opTitle: blank,
      opSubtitle: blank,
      edTitle: blank,
      edSubtitle: blank,
      fontFamily: 'Shippori Mincho',
      primaryColor: '#D4AF37',
      accentColor: '#C84B31',
      darkColor: '#0D0F12',
    },
    glossary: [],
    videoClips: [],
    subtitles: [],
    accessCards: [],
    audioTracks: [],
    chapters: [],
    ...parts,
  };
}
