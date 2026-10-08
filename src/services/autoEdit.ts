/**
 * Automatic editing: turns a batch of shrine-visit videos into a draft project.
 * Videos are put in recording order; talking is kept whole; the rest of the footage
 * contributes its steadiest moments until the target length is filled. Claude (optional)
 * writes the shrine card, captions, etiquette tips and chapters from one frame per clip.
 */
import {
  AccessCardItem,
  ChapterItem,
  GlossaryItem,
  LocalizedText,
  MultilingualSubtitleItem,
  ProjectData,
  VideoClipItem,
} from '../types';
import { analyzeVideo, captureFrameJpeg, QUALITY_STEP, type VideoAnalysis } from './videoAnalysis';
import { generateEditScript, type ClaudeModelId, type EditScript } from './claudeApi';
import { saveMediaFile } from './storage';

export interface AutoEditOptions {
  /** Length of the finished video including the OP/ED cards (seconds) */
  targetDuration: number;
  shrineName: string;
  notes: string;
  /** null: no on-screen text is written */
  claude: { apiKey: string; model: ClaudeModelId } | null;
}

export interface AutoEditProgress {
  percentage: number;
  statusText: string;
}

export interface AutoEditSummary {
  totalVideos: number;
  usedVideos: number;
  duration: number;
  orderedBy: 'recordedAt' | 'fileName';
  videosWithSpeech: number;
  /** Talking alone is longer than the target, so the video ended up longer */
  overTarget: boolean;
  hasAccessCard: boolean;
  telopCount: number;
  chapterCount: number;
  claudeUsed: boolean;
  claudeError: string | null;
  warnings: string[];
}

// The first and last moments of a recording usually shake from pressing the button
const EDGE_SKIP_SEC = 0.6;
const MIN_SHOT_SEC = 2;
// Picture quality (0-1) below which footage is not added just to reach the target length
const MIN_FILL_QUALITY = 0.3;
// Cuts closer together than this within one video are joined instead of jumping
const MIN_JUMP_SEC = 1;
// Original sound of clips without talking stays in as ambience, a little lower
const SCENERY_VOLUME = 0.7;
const SANCTUARY_CARD_SEC = 7;
const ACCESS_CARD_SEC = 7;
const MAX_TELOP_SEC = 7;
const MIN_TELOP_SEC = 2.5;
// YouTube ignores chapters shorter than this
const MIN_CHAPTER_SEC = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Choosing the moments to use
// ---------------------------------------------------------------------------

export interface PlannedSegment {
  /** Index into the ordered videos */
  video: number;
  start: number;
  end: number;
  hasSpeech: boolean;
}

/** Mean picture quality over [start, end) of a video's source time */
function createWindowScorer(video: VideoAnalysis): (start: number, end: number) => number {
  const q = video.quality;
  if (!q || q.length === 0) return () => 0.5;
  const prefix = new Float64Array(q.length + 1);
  for (let i = 0; i < q.length; i++) prefix[i + 1] = prefix[i] + q[i];
  return (start, end) => {
    const i0 = Math.min(q.length - 1, Math.max(0, Math.floor(start / QUALITY_STEP)));
    const i1 = Math.min(q.length, Math.max(i0 + 1, Math.ceil(end / QUALITY_STEP)));
    return (prefix[i1] - prefix[i0]) / (i1 - i0);
  };
}

function bestWindow(score: (s: number, e: number) => number, from: number, to: number, length: number) {
  let best = { start: from, end: from + length, score: -1 };
  for (let s = from; s + length <= to + 1e-6; s += QUALITY_STEP) {
    const value = score(s, s + length);
    if (value > best.score) best = { start: s, end: s + length, score: value };
  }
  return best;
}

/** `regions` with the `cuts` taken out */
function subtractRanges(regions: [number, number][], cuts: [number, number][]): [number, number][] {
  let pieces = regions;
  for (const [s, e] of cuts) {
    pieces = pieces.flatMap(([rs, re]): [number, number][] => {
      if (e <= rs || s >= re) return [[rs, re]];
      const out: [number, number][] = [];
      if (s > rs) out.push([rs, s]);
      if (e < re) out.push([e, re]);
      return out;
    });
  }
  return pieces;
}

/** Footage outside talking and the shaky first/last moments, in pieces long enough for a shot */
function freeRegions(video: VideoAnalysis): [number, number][] {
  const edge = video.duration >= MIN_SHOT_SEC + 2 * EDGE_SKIP_SEC ? EDGE_SKIP_SEC : 0;
  return subtractRanges([[edge, video.duration - edge]], video.speechRanges).filter(([s, e]) => e - s >= MIN_SHOT_SEC);
}

const totalLength = (regions: [number, number][]) => sum(regions.map(([s, e]) => e - s));

/** The source-time pieces of regions[] that fall between offsets `from` and `to` of their joined length */
function sliceRegions(regions: [number, number][], from: number, to: number): [number, number][] {
  const pieces: [number, number][] = [];
  let offset = 0;
  for (const [rs, re] of regions) {
    const len = re - rs;
    const a = Math.max(from, offset);
    const b = Math.min(to, offset + len);
    if (b > a) pieces.push([rs + (a - offset), rs + (b - offset)]);
    offset += len;
  }
  return pieces;
}

/** Steady moments (no talking) filling `budget` seconds with shots of about `shotLength` */
function pickScenery(
  videos: VideoAnalysis[],
  free: [number, number][][],
  budget: number,
  shotLength: number
): PlannedSegment[] {
  const scorers = videos.map(createWindowScorer);
  const freeLength = free.map(totalLength);
  const eligible = videos.map((_, i) => i).filter((i) => free[i].length > 0);
  if (eligible.length === 0) return [];

  let count = Math.max(1, Math.round(budget / shotLength));
  let shot = budget / count;
  let chosen = eligible;
  if (count < eligible.length) {
    // Not enough room for the usual shot length in every video: shorter shots, so each video still appears
    shot = budget / eligible.length;
    if (shot >= MIN_SHOT_SEC) {
      count = eligible.length;
    } else {
      // Still too many: keep the videos with the best moments, in recording order
      count = Math.max(1, Math.floor(budget / MIN_SHOT_SEC));
      shot = budget / count;
      const bestScore = (i: number) =>
        Math.max(...free[i].map(([s, e]) => bestWindow(scorers[i], s, e, Math.min(shot, e - s)).score));
      chosen = [...eligible].sort((a, b) => bestScore(b) - bestScore(a)).slice(0, count).sort((a, b) => a - b);
    }
  }

  // One shot per video, then the rest go to the videos with the most footage per shot (D'Hondt)
  const quota = new Map(chosen.map((i) => [i, 1]));
  for (let left = count - chosen.length; left > 0; left--) {
    let pick = -1;
    let bestRatio = 0;
    for (const i of chosen) {
      const next = quota.get(i)! + 1;
      if (next * shot > freeLength[i]) continue;
      if (freeLength[i] / next > bestRatio) {
        bestRatio = freeLength[i] / next;
        pick = i;
      }
    }
    if (pick < 0) break;
    quota.set(pick, quota.get(pick)! + 1);
  }

  // Within a video, its shots are spread out: the best moment from each equal slice of its footage
  const segments: PlannedSegment[] = [];
  for (const i of chosen) {
    const q = quota.get(i)!;
    for (let k = 0; k < q; k++) {
      const pieces = sliceRegions(free[i], (k * freeLength[i]) / q, ((k + 1) * freeLength[i]) / q);
      const longest = Math.max(0, ...pieces.map(([s, e]) => e - s));
      const length = Math.min(shot, longest);
      if (length < Math.min(MIN_SHOT_SEC, shot)) continue;
      let best: { start: number; end: number; score: number } | null = null;
      for (const [s, e] of pieces) {
        if (e - s < length - 1e-6) continue;
        const w = bestWindow(scorers[i], s, e, length);
        if (!best || w.score > best.score) best = w;
      }
      if (best) segments.push({ video: i, start: best.start, end: best.end, hasSpeech: false });
    }
  }

  // Videos shorter than a shot leave the total short of the target: fill the gap with more
  // steady moments, from the videos with the most footage still unused
  let shortfall = budget - sum(segments.map((s) => s.end - s.start));
  while (shortfall >= MIN_SHOT_SEC) {
    const length = Math.min(shot, shortfall);
    const candidates = eligible
      .map((i) => {
        const taken = segments.filter((s) => s.video === i).map((s): [number, number] => [s.start, s.end]);
        const pieces = subtractRanges(free[i], taken).filter(([s, e]) => e - s >= MIN_SHOT_SEC);
        return { i, pieces, unused: totalLength(pieces) };
      })
      .filter((c) => c.pieces.length > 0)
      .sort((a, b) => b.unused - a.unused);

    let added: PlannedSegment | null = null;
    for (const { i, pieces } of candidates) {
      // The steadiest moment wins, even if its piece is shorter than the gap to fill
      let best: { start: number; end: number; score: number } | null = null;
      for (const [s, e] of pieces) {
        const w = bestWindow(scorers[i], s, e, Math.min(length, e - s));
        if (!best || w.score > best.score) best = w;
      }
      // Only footage worth watching: a shaky walk is not used just to reach the length
      if (best && best.score >= MIN_FILL_QUALITY) {
        added = { video: i, start: best.start, end: best.end, hasSpeech: false };
        break;
      }
    }
    if (!added) break;
    segments.push(added);
    shortfall -= added.end - added.start;
  }
  return segments;
}

/**
 * Which parts of the (ordered) videos to use. `contentBudget` is the time between the OP and ED cards.
 */
export function planSegments(videos: VideoAnalysis[], contentBudget: number, shotLength: number): PlannedSegment[] {
  const segments: PlannedSegment[] = [];
  // Talking is always kept whole: cutting into someone's sentence sounds broken
  videos.forEach((v, i) => {
    for (const [s, e] of v.speechRanges) segments.push({ video: i, start: s, end: e, hasSpeech: true });
  });
  const budget = contentBudget - sum(segments.map((s) => s.end - s.start));

  const free = videos.map(freeRegions);
  const allFree = sum(free.map(totalLength));
  if (budget >= MIN_SHOT_SEC && allFree > 0) {
    if (allFree <= budget) {
      // No more footage than the target: use all of it
      free.forEach((regions, i) => {
        for (const [s, e] of regions) segments.push({ video: i, start: s, end: e, hasSpeech: false });
      });
    } else {
      segments.push(...pickScenery(videos, free, budget, shotLength));
    }
  }

  // Recording order, and moments of one video that nearly touch are joined into one continuous shot
  segments.sort((a, b) => a.video - b.video || a.start - b.start);
  const merged: PlannedSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.video === seg.video && seg.start - last.end < MIN_JUMP_SEC) {
      last.end = Math.max(last.end, seg.end);
      last.hasSpeech ||= seg.hasSpeech;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Building the project
// ---------------------------------------------------------------------------

/** Consecutive timeline clips cut from the same video; Claude writes one clip's text per run */
interface Run {
  video: number;
  start: number;
  end: number;
  segments: PlannedSegment[];
}

function toRuns(segments: PlannedSegment[], timelineStart: number): Run[] {
  const runs: Run[] = [];
  let t = timelineStart;
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    const last = runs[runs.length - 1];
    if (last && last.video === seg.video) {
      last.end = t + dur;
      last.segments.push(seg);
    } else {
      runs.push({ video: seg.video, start: t, end: t + dur, segments: [seg] });
    }
    t += dur;
  }
  return runs;
}

const hasText = (t: LocalizedText | undefined) => !!t && t.ja.trim() !== '';
const orEnglish = (t: LocalizedText): LocalizedText => ({ ja: t.ja.trim(), en: t.en.trim() || t.ja.trim() });

function buildProject(
  base: ProjectData,
  videos: VideoAnalysis[],
  segments: PlannedSegment[],
  media: Map<number, { dataUrl: string; blobKey?: string }>,
  script: EditScript | null,
  shrineName: string
): { project: ProjectData; telopCount: number; chapterCount: number; hasAccessCard: boolean } {
  const stamp = Date.now();
  const now = new Date().toISOString();
  const op = Math.max(0, base.branding.opDuration);

  // 1. Clips, back to back after the OP card
  let t = op;
  const videoClips: VideoClipItem[] = segments.map((seg, k) => {
    const v = videos[seg.video];
    const m = media.get(seg.video)!;
    const clip: VideoClipItem = {
      id: `clip_${stamp}_${k}`,
      name: v.name,
      type: 'video',
      dataUrl: m.dataUrl,
      blobKey: m.blobKey,
      startTime: round2(t),
      duration: round2(seg.end - seg.start),
      trimStart: round2(seg.start),
      trimEnd: round2(seg.end),
      volume: seg.hasSpeech ? 1 : SCENERY_VOLUME,
      ...(v.speechRanges.length > 0 ? { speechRanges: v.speechRanges } : {}),
    };
    t += seg.end - seg.start;
    return clip;
  });
  const contentEnd = round2(t);
  const duration = round2(contentEnd + Math.max(0, base.branding.edDuration));
  const runs = toRuns(segments, op);
  const subtitles: MultilingualSubtitleItem[] = [];

  // 2. Shrine name card over the first clip
  const name: LocalizedText = hasText(script?.sanctuary.name)
    ? orEnglish(script!.sanctuary.name)
    : { ja: shrineName.trim(), en: shrineName.trim() };
  let headerEnd = op;
  if (name.ja && contentEnd - op >= 4) {
    const start = round2(op + 0.5);
    const dur = round2(Math.min(SANCTUARY_CARD_SEC, contentEnd - start - 0.5));
    const meta = script?.sanctuary;
    const blank: LocalizedText = { ja: '', en: '' };
    subtitles.push({
      id: `sub_${stamp}_header`,
      startTime: start,
      duration: dur,
      category: 'sanctuary_header',
      text: name,
      sanctuaryMeta: {
        name,
        location: meta ? orEnglish(meta.location) : blank,
        deity: meta ? orEnglish(meta.deity) : blank,
        blessing: meta ? orEnglish(meta.blessing) : blank,
      },
    });
    headerEnd = start + dur;
  }

  // 3. Access card over the last moments before the ED card, where the video was recorded
  const location = videos.find((v) => v.location)?.location ?? null;
  const accessCards: AccessCardItem[] = [];
  const accessStart = round2(Math.max(headerEnd + 0.5, contentEnd - ACCESS_CARD_SEC));
  if (location && name.ja && contentEnd - accessStart >= 4) {
    const a = script?.access;
    const blank: LocalizedText = { ja: '', en: '' };
    accessCards.push({
      id: `access_${stamp}`,
      startTime: accessStart,
      duration: round2(contentEnd - accessStart),
      sanctuaryName: name,
      address: a ? orEnglish(a.address) : blank,
      latLng: { lat: Math.round(location.lat * 1e5) / 1e5, lng: Math.round(location.lng * 1e5) / 1e5 },
      nearestStation: a ? orEnglish(a.nearestStation) : blank,
      parking: a ? orEnglish(a.parking) : blank,
      visitingHours: a ? orEnglish(a.visitingHours) : blank,
      mapMode: 'leaflet',
      attribution: '© OpenStreetMap contributors',
    });
  }
  const textEnd = accessCards.length > 0 ? accessStart - 0.3 : contentEnd;

  // 4. Captions and etiquette tips, one per run at most, clear of the two cards
  let telopCount = 0;
  const chapters: ChapterItem[] = [];
  runs.forEach((run, k) => {
    const entry = script?.clips.find((c) => c.index === k + 1) ?? script?.clips[k];
    if (!entry) return;

    if (hasText(entry.chapter)) {
      chapters.push({ id: `ch_${stamp}_${k}`, timeSec: Math.floor(run.start), title: orEnglish(entry.chapter) });
    }

    if (entry.telop === 'none' || !hasText(entry.text)) return;
    const start = Math.max(run.start + 0.4, headerEnd + 0.3);
    const end = Math.min(run.end - 0.4, textEnd);
    const dur = Math.min(MAX_TELOP_SEC, end - start);
    if (dur < MIN_TELOP_SEC) return;
    const text = orEnglish(entry.text);
    subtitles.push(
      entry.telop === 'etiquette'
        ? {
            id: `sub_${stamp}_${k}`,
            startTime: round2(start),
            duration: round2(dur),
            category: 'etiquette_tip',
            text,
            etiquetteTip: {
              title: hasText(entry.tipTitle) ? orEnglish(entry.tipTitle) : { ja: '参拝の作法', en: 'Worship Etiquette' },
              detail: text,
            },
          }
        : { id: `sub_${stamp}_${k}`, startTime: round2(start), duration: round2(dur), category: 'commentary', text }
    );
    telopCount++;
  });

  // 5. Chapters: YouTube needs the first at 0:00 and each at least 10 seconds long
  if (chapters.length > 0) chapters[0] = { ...chapters[0], timeSec: 0 };
  const validChapters: ChapterItem[] = [];
  for (const ch of chapters) {
    const last = validChapters[validChapters.length - 1];
    if (!last || ch.timeSec - last.timeSec >= MIN_CHAPTER_SEC) validChapters.push(ch);
  }
  while (validChapters.length > 1 && duration - validChapters[validChapters.length - 1].timeSec < MIN_CHAPTER_SEC) {
    validChapters.pop();
  }

  // 6. Proper nouns Claude used, so later translations keep the same English
  const glossary: GlossaryItem[] = [...base.glossary];
  const addTerm = (japanese: string, english: string) => {
    const ja = japanese.trim();
    const en = english.trim();
    if (ja && en && ja !== en && !glossary.some((g) => g.japanese === ja)) {
      glossary.push({ id: `g_${stamp}_${glossary.length}`, japanese: ja, english: en });
    }
  };
  addTerm(name.ja, name.en);
  for (const g of script?.glossary ?? []) addTerm(g.japanese, g.english);

  const title = hasText(script?.videoTitle) ? script!.videoTitle.ja.trim() : name.ja ? `${name.ja} 参拝紀行` : base.title;

  const project: ProjectData = {
    ...base,
    id: `project_${stamp}`,
    title,
    duration,
    createdAt: now,
    updatedAt: now,
    branding: name.ja
      ? {
          ...base.branding,
          // Without an English name the English video falls back to the Japanese subtitle
          opSubtitle: { ja: `${name.ja} 参拝紀行`, en: name.en !== name.ja ? `A Visit to ${name.en}` : '' },
        }
      : base.branding,
    glossary,
    videoClips,
    subtitles,
    accessCards,
    // BGM and ambience with a real sound file carry over and now span the new video; narrations belonged to the old timeline
    audioTracks: base.audioTracks
      .filter((a) => (a.type === 'bgm' || a.type === 'ambience') && a.dataUrl)
      .map((a) => ({ ...a, startTime: 0, duration, trimStart: 0 })),
    chapters: validChapters,
    mutedTracks: {},
  };
  return { project, telopCount, chapterCount: validChapters.length, hasAccessCard: accessCards.length > 0 };
}

// ---------------------------------------------------------------------------
// The whole run
// ---------------------------------------------------------------------------

export async function runAutoEdit(
  files: File[],
  base: ProjectData,
  options: AutoEditOptions,
  onProgress: (p: AutoEditProgress) => void,
  signal?: AbortSignal
): Promise<{ project: ProjectData; summary: AutoEditSummary }> {
  const warnings: string[] = [];
  const isLandscape = base.aspectRatio === '16:9';

  // 1. Analysis (most of the time): progress is weighted by file size
  const totalBytes = Math.max(1, sum(files.map((f) => f.size)));
  let doneBytes = 0;
  const analyzed: VideoAnalysis[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const status = `動画を解析中 (${i + 1} / ${files.length})：${file.name}`;
    try {
      const result = await analyzeVideo(
        file,
        (f) => onProgress({ percentage: Math.floor(((doneBytes + f * file.size) / totalBytes) * 70), statusText: status }),
        signal
      );
      analyzed.push(result);
      warnings.push(...result.warnings);
    } catch (e) {
      if (signal?.aborted) throw e;
      warnings.push(e instanceof Error ? e.message : String(e));
    }
    doneBytes += file.size;
  }
  if (analyzed.length === 0) {
    throw new Error('使える動画がありませんでした。' + (warnings.length > 0 ? `\n${warnings.join('\n')}` : ''));
  }

  // 2. Recording order: by the recorded time when every video has one, otherwise by file name
  // (cameras number their files in order, e.g. IMG_0012.MOV, VID_20261008_101530.mp4)
  const orderedBy: AutoEditSummary['orderedBy'] = analyzed.every((v) => v.recordedAt) ? 'recordedAt' : 'fileName';
  const byName = (a: VideoAnalysis, b: VideoAnalysis) => a.file.name.localeCompare(b.file.name, 'ja', { numeric: true });
  const videos = [...analyzed].sort((a, b) =>
    orderedBy === 'recordedAt' ? a.recordedAt!.getTime() - b.recordedAt!.getTime() || byName(a, b) : byName(a, b)
  );

  // 3. Which moments to use
  onProgress({ percentage: 72, statusText: '見どころを選んでいます...' });
  const op = Math.max(0, base.branding.opDuration);
  const ed = Math.max(0, base.branding.edDuration);
  const contentBudget = Math.max(5, options.targetDuration - op - ed);
  const segments = planSegments(videos, contentBudget, isLandscape ? 6 : 3);
  if (segments.length === 0) {
    throw new Error('動画が短すぎるため、使える場面を選べませんでした。');
  }
  const contentLength = sum(segments.map((s) => s.end - s.start));

  // 4. On-screen text from Claude, looking at one frame of each run
  let script: EditScript | null = null;
  let claudeError: string | null = null;
  if (options.claude) {
    const runs = toRuns(segments, 0);
    const clips = [];
    for (let k = 0; k < runs.length; k++) {
      signal?.throwIfAborted();
      onProgress({
        percentage: 74 + Math.floor((k / runs.length) * 6),
        statusText: `Claude に見せる場面を準備中 (${k + 1} / ${runs.length})...`,
      });
      const run = runs[k];
      const longest = run.segments.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
      clips.push({
        durationSec: run.end - run.start,
        hasSpeech: run.segments.some((s) => s.hasSpeech),
        imageBase64: await captureFrameJpeg(videos[run.video].file, (longest.start + longest.end) / 2),
      });
    }
    onProgress({ percentage: 82, statusText: 'Claude がテロップ・チャプター・案内を作成中...（1分ほどかかることがあります）' });
    try {
      script = await generateEditScript(
        { shrineName: options.shrineName, notes: options.notes, clips, glossary: base.glossary },
        options.claude.apiKey,
        options.claude.model,
        signal
      );
    } catch (e) {
      if (signal?.aborted) throw e;
      claudeError = e instanceof Error ? e.message : String(e);
    }
  }

  // 5. Keep the files in this browser so the project survives a reload
  onProgress({ percentage: 95, statusText: '素材をブラウザに保存中...' });
  const media = new Map<number, { dataUrl: string; blobKey?: string }>();
  const usedVideos = [...new Set(segments.map((s) => s.video))];
  for (const index of usedVideos) {
    signal?.throwIfAborted();
    const file = videos[index].file;
    // Running the automatic edit again reuses the copies already stored
    const blobKey = await saveMediaFile(file).catch(() => {
      warnings.push(`「${file.name}」をブラウザに保存できませんでした。ページを再読み込みすると、この動画は表示されなくなります。`);
      return undefined;
    });
    media.set(index, { dataUrl: URL.createObjectURL(file), blobKey });
  }

  // 6. The project
  const built = buildProject(base, videos, segments, media, script, options.shrineName);
  if (!built.hasAccessCard && videos.every((v) => !v.location)) {
    warnings.push('動画に撮影場所（GPS）が記録されていなかったため、アクセス案内カードは作りませんでした。「地図」タブから追加できます。');
  }
  onProgress({ percentage: 100, statusText: '完成しました' });

  return {
    project: built.project,
    summary: {
      totalVideos: files.length,
      usedVideos: usedVideos.length,
      duration: built.project.duration,
      orderedBy,
      videosWithSpeech: videos.filter((v) => v.speechRanges.length > 0).length,
      overTarget: contentLength > contentBudget + 1,
      hasAccessCard: built.hasAccessCard,
      telopCount: built.telopCount,
      chapterCount: built.chapterCount,
      claudeUsed: script !== null,
      claudeError,
      warnings,
    },
  };
}
