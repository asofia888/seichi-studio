/**
 * Checks and repairs project data that comes from outside the editor (a project file, a backup,
 * what an earlier version saved in the browser), so the editor only ever works on a complete
 * project: missing parts are filled in, values of the wrong kind fall back to a default, and
 * timeline items that cannot be placed (no usable length, unknown kind) are left out.
 */
import {
  AccessCardItem,
  AudioTrackItem,
  BrandingSettings,
  ChapterItem,
  GlossaryItem,
  LocalizedText,
  MultilingualSubtitleItem,
  ProjectData,
  VideoClipItem,
} from '../types';

/** The data is not a project at all (as opposed to a project with parts missing) */
export class InvalidProjectError extends Error {
  constructor() {
    super('プロジェクトのデータではありません。');
  }
}

export interface NormalizeReport {
  /** Timeline items left out because they could not be used */
  dropped: number;
}

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const optionalStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** A finite number (numeric text counts), or null */
function finite(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number => {
  const n = finite(v);
  return n === null ? fallback : clamp(n, min, max);
};

const optionalNum = (v: unknown, min = -Infinity, max = Infinity): number | undefined => {
  const n = finite(v);
  return n === null ? undefined : clamp(n, min, max);
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const localized = (v: unknown): LocalizedText => {
  if (typeof v === 'string') return { ja: v, en: '' };
  return isRecord(v) ? { ja: str(v.ja), en: str(v.en) } : { ja: '', en: '' };
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Ids that are present and unique within their list; anything else gets a new one */
function idMaker(prefix: string) {
  const used = new Set<string>();
  return (v: unknown): string => {
    let id = typeof v === 'string' && v !== '' && !used.has(v) ? v : '';
    for (let n = used.size + 1; id === ''; n++) {
      const candidate = `${prefix}_${n}`;
      if (!used.has(candidate)) id = candidate;
    }
    used.add(id);
    return id;
  };
}

/** Where an item sits on the timeline, or null when it has no usable length */
function placement(raw: Raw): { startTime: number; duration: number } | null {
  const duration = finite(raw.duration);
  if (duration === null || duration <= 0) return null;
  return { startTime: num(raw.startTime, 0, 0), duration };
}

/** Normalize each entry of a list, leaving out (and counting) the ones that cannot be used */
function items<T>(v: unknown, report: NormalizeReport, convert: (raw: Raw) => T | null): T[] {
  const result: T[] = [];
  for (const entry of list(v)) {
    const item = isRecord(entry) ? convert(entry) : null;
    if (item) result.push(item);
    else report.dropped++;
  }
  return result;
}

const FONT_FAMILIES = ['Shippori Mincho', 'Noto Serif JP', 'Zen Old Mincho'] as const;
const TRANSITIONS = ['dissolve', 'fade_black', 'fade_white'] as const;
const KEN_BURNS_PRESETS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'tilt_up', 'subtle_drift', 'custom'] as const;
const SUBTITLE_CATEGORIES = ['sanctuary_header', 'commentary', 'etiquette_tip'] as const;
const AUDIO_TYPES = ['narration', 'ambience', 'bgm'] as const;
const MUTABLE_TRACKS = ['video', 'subtitles', 'narration', 'ambience', 'bgm'] as const;

function branding(v: unknown): BrandingSettings {
  const raw = isRecord(v) ? v : {};
  return {
    channelName: str(raw.channelName),
    // A project that says nothing about its opening and ending cards has none
    opDuration: num(raw.opDuration, 0, 0),
    edDuration: num(raw.edDuration, 0, 0),
    opTitle: localized(raw.opTitle),
    opSubtitle: localized(raw.opSubtitle),
    edTitle: localized(raw.edTitle),
    edSubtitle: localized(raw.edSubtitle),
    fontFamily: oneOf(raw.fontFamily, FONT_FAMILIES, 'Shippori Mincho'),
    primaryColor: str(raw.primaryColor, '#D4AF37'),
    accentColor: str(raw.accentColor, '#C84B31'),
    darkColor: str(raw.darkColor, '#0D0F12'),
  };
}

function videoClip(raw: Raw, id: string): VideoClipItem | null {
  const at = placement(raw);
  if (!at || (raw.type !== 'video' && raw.type !== 'image')) return null;

  const clip: VideoClipItem = {
    id,
    name: str(raw.name, '無題'),
    type: raw.type,
    ...at,
    trimStart: num(raw.trimStart, 0, 0),
    trimEnd: num(raw.trimEnd, at.duration, 0),
  };
  const dataUrl = optionalStr(raw.dataUrl);
  if (dataUrl) clip.dataUrl = dataUrl;
  const blobKey = optionalStr(raw.blobKey);
  if (blobKey) clip.blobKey = blobKey;

  const sourceDuration = finite(raw.sourceDuration);
  if (sourceDuration !== null && sourceDuration > 0) clip.sourceDuration = sourceDuration;
  const volume = optionalNum(raw.volume, 0, 1);
  if (volume !== undefined) clip.volume = volume;
  if (raw.track === 'overlay' || raw.track === 'main') clip.track = raw.track;
  const speed = finite(raw.speed);
  if (speed !== null && speed > 0) clip.speed = speed;

  if (Array.isArray(raw.speechRanges)) {
    clip.speechRanges = raw.speechRanges.flatMap((range): [number, number][] => {
      if (!Array.isArray(range)) return [];
      const start = finite(range[0]);
      const end = finite(range[1]);
      return start !== null && end !== null && end > start ? [[start, end]] : [];
    });
  }
  if (isRecord(raw.transition) && TRANSITIONS.includes(raw.transition.type as (typeof TRANSITIONS)[number])) {
    clip.transition = {
      type: raw.transition.type as (typeof TRANSITIONS)[number],
      duration: num(raw.transition.duration, 0, 0),
    };
  }
  if (isRecord(raw.color)) {
    clip.color = {
      brightness: num(raw.color.brightness, 0, -50, 50),
      contrast: num(raw.color.contrast, 0, -50, 50),
      saturation: num(raw.color.saturation, 0, -50, 50),
      temperature: num(raw.color.temperature, 0, -50, 50),
    };
  }
  if (isRecord(raw.kenBurns)) {
    const kb = raw.kenBurns;
    clip.kenBurns = {
      enabled: kb.enabled !== false,
      scaleStart: num(kb.scaleStart, 1, 0.1, 10),
      scaleEnd: num(kb.scaleEnd, 1, 0.1, 10),
      panX: num(kb.panX, 0),
      panY: num(kb.panY, 0),
    };
    if (KEN_BURNS_PRESETS.includes(kb.preset as (typeof KEN_BURNS_PRESETS)[number])) {
      clip.kenBurns.preset = kb.preset as (typeof KEN_BURNS_PRESETS)[number];
    }
    if (isRecord(kb.focusPoint)) {
      clip.kenBurns.focusPoint = { x: num(kb.focusPoint.x, 0.5, 0, 1), y: num(kb.focusPoint.y, 0.5, 0, 1) };
    }
  }
  return clip;
}

function subtitle(raw: Raw, id: string): MultilingualSubtitleItem | null {
  const at = placement(raw);
  if (!at) return null;
  const sub: MultilingualSubtitleItem = {
    id,
    ...at,
    category: oneOf(raw.category, SUBTITLE_CATEGORIES, 'commentary'),
    text: localized(raw.text),
  };
  if (isRecord(raw.sanctuaryMeta)) {
    const meta = raw.sanctuaryMeta;
    sub.sanctuaryMeta = {
      name: localized(meta.name),
      location: localized(meta.location),
      deity: localized(meta.deity),
      blessing: localized(meta.blessing),
    };
  }
  if (isRecord(raw.etiquetteTip)) {
    sub.etiquetteTip = { title: localized(raw.etiquetteTip.title), detail: localized(raw.etiquetteTip.detail) };
  }
  return sub;
}

function accessCard(raw: Raw, id: string): AccessCardItem | null {
  const at = placement(raw);
  if (!at) return null;
  const latLng = isRecord(raw.latLng) ? raw.latLng : {};
  const card: AccessCardItem = {
    id,
    ...at,
    sanctuaryName: localized(raw.sanctuaryName),
    address: localized(raw.address),
    latLng: { lat: num(latLng.lat, 0, -90, 90), lng: num(latLng.lng, 0, -180, 180) },
    nearestStation: localized(raw.nearestStation),
    parking: localized(raw.parking),
    visitingHours: localized(raw.visitingHours),
    mapMode: raw.mapMode === 'custom_image' ? 'custom_image' : 'leaflet',
    attribution: str(raw.attribution),
  };
  const map = optionalStr(raw.customMapDataUrl);
  if (map) card.customMapDataUrl = map;
  return card;
}

function audioTrack(raw: Raw, id: string): AudioTrackItem | null {
  const duration = finite(raw.duration);
  if (!AUDIO_TYPES.includes(raw.type as (typeof AUDIO_TYPES)[number])) return null;
  const type = raw.type as (typeof AUDIO_TYPES)[number];
  // BGM and ambience are fitted to the video, so one without a length yet is still usable
  const isBed = type === 'bgm' || type === 'ambience';
  if (duration === null || duration < 0 || (duration === 0 && !isBed)) return null;

  const track: AudioTrackItem = {
    id,
    name: str(raw.name, '無題'),
    type,
    startTime: num(raw.startTime, 0, 0),
    duration,
    volume: num(raw.volume, 1, 0, 1),
  };
  const dataUrl = optionalStr(raw.dataUrl);
  if (dataUrl) track.dataUrl = dataUrl;
  const blobKey = optionalStr(raw.blobKey);
  if (blobKey) track.blobKey = blobKey;
  if (typeof raw.isRecorded === 'boolean') track.isRecorded = raw.isRecorded;
  if (Array.isArray(raw.waveform)) {
    track.waveform = raw.waveform.flatMap((peak) => {
      const n = finite(peak);
      return n === null ? [] : [clamp(n, 0, 1)];
    });
  }
  const sourceDuration = finite(raw.sourceDuration);
  if (sourceDuration !== null && sourceDuration > 0) track.sourceDuration = sourceDuration;
  const trimStart = optionalNum(raw.trimStart, 0);
  if (trimStart !== undefined) track.trimStart = trimStart;
  const fadeIn = optionalNum(raw.fadeInSec, 0);
  if (fadeIn !== undefined) track.fadeInSec = fadeIn;
  const fadeOut = optionalNum(raw.fadeOutSec, 0);
  if (fadeOut !== undefined) track.fadeOutSec = fadeOut;
  if (isRecord(raw.autoDucking)) {
    track.autoDucking = {
      enabled: raw.autoDucking.enabled !== false,
      duckVolume: num(raw.autoDucking.duckVolume, 0.22, 0, 1),
      fadeSec: num(raw.autoDucking.fadeSec, 0.4, 0),
    };
  }
  return track;
}

/**
 * A complete project made from `raw`. Throws InvalidProjectError when `raw` is not a project at
 * all; anything less than that is repaired. `report` is told how much had to be left out.
 */
export function normalizeProject(raw: unknown, report: NormalizeReport = { dropped: 0 }): ProjectData {
  const hasTimeline =
    isRecord(raw) &&
    [raw.videoClips, raw.subtitles, raw.accessCards, raw.audioTracks, raw.chapters].some(Array.isArray);
  if (!isRecord(raw) || !hasTimeline) throw new InvalidProjectError();

  const now = new Date().toISOString();
  const clipId = idMaker('clip');
  const subId = idMaker('sub');
  const accessId = idMaker('access');
  const audioId = idMaker('audio');
  const chapterId = idMaker('ch');
  const glossaryId = idMaker('g');

  const project: ProjectData = {
    id: str(raw.id) || `project_${Date.now()}`,
    title: str(raw.title).trim() ? str(raw.title) : '無題のプロジェクト',
    aspectRatio: raw.aspectRatio === '9:16' ? '9:16' : '16:9',
    fps: num(raw.fps, 30, 1, 120),
    // Fitted to what is on the timeline when the project enters the editor
    duration: num(raw.duration, 0, 0),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
    branding: branding(raw.branding),
    glossary: items(raw.glossary, report, (g): GlossaryItem | null => {
      const item: GlossaryItem = { id: glossaryId(g.id), japanese: str(g.japanese), english: str(g.english) };
      const note = optionalStr(g.note);
      if (note) item.note = note;
      return item;
    }),
    videoClips: items(raw.videoClips, report, (c) => videoClip(c, clipId(c.id))),
    subtitles: items(raw.subtitles, report, (s) => subtitle(s, subId(s.id))),
    accessCards: items(raw.accessCards, report, (a) => accessCard(a, accessId(a.id))),
    audioTracks: items(raw.audioTracks, report, (a) => audioTrack(a, audioId(a.id))),
    chapters: items(raw.chapters, report, (c): ChapterItem | null => ({
      id: chapterId(c.id),
      timeSec: num(c.timeSec, 0, 0),
      title: localized(c.title),
    })),
  };

  const vignette = optionalNum(raw.vignette, 0, 1);
  if (vignette !== undefined) project.vignette = vignette;
  if (isRecord(raw.mutedTracks)) {
    const muted: NonNullable<ProjectData['mutedTracks']> = {};
    for (const key of MUTABLE_TRACKS) {
      if (typeof raw.mutedTracks[key] === 'boolean') muted[key] = raw.mutedTracks[key] as boolean;
    }
    project.mutedTracks = muted;
  }
  return project;
}
