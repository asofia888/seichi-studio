/**
 * SRT (SubRip Subtitle) file exporter & YouTube Chapter timestamp generator
 */
import { MultilingualSubtitleItem, ChapterItem, SupportedLanguage } from '../types';

function formatSecondsToSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

export function generateSRT(subtitles: MultilingualSubtitleItem[], lang: SupportedLanguage): string {
  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
  const srtEntries: string[] = [];

  let index = 1;
  for (const sub of sorted) {
    const text = sub.text[lang] || sub.text['ja'] || '';
    if (!text.trim()) continue;

    const startStr = formatSecondsToSRTTime(sub.startTime);
    const endStr = formatSecondsToSRTTime(sub.startTime + sub.duration);

    srtEntries.push(`${index}\n${startStr} --> ${endStr}\n${text.trim()}\n`);
    index++;
  }

  return srtEntries.join('\n');
}

export function downloadSRTFile(subtitles: MultilingualSubtitleItem[], lang: SupportedLanguage, projectTitle: string): void {
  const srtContent = generateSRT(subtitles, lang);
  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const safeName = projectTitle.replace(/[/\\?%*:|"<>]/g, '_') || 'sanctuary';
  anchor.download = `${safeName}_${lang.toUpperCase()}.srt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function generateYouTubeDescription(
  chapters: ChapterItem[],
  projectTitle: string,
  sanctuaryInfo?: { name: string; address: string; deities?: string }
): string {
  const sorted = [...chapters].sort((a, b) => a.timeSec - b.timeSec);
  
  // YouTube requires the first timestamp to be 0:00 (or 00:00)
  const timestamps = sorted.map((ch) => {
    const mins = Math.floor(ch.timeSec / 60);
    const secs = Math.floor(ch.timeSec % 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(mins)}:${pad(secs)} ${ch.title.ja}`;
  });

  const lines: string[] = [
    `⛩️ ${projectTitle}`,
    '',
    sanctuaryInfo ? `【参拝情報】` : '',
    sanctuaryInfo?.name ? `■ 聖地名: ${sanctuaryInfo.name}` : '',
    sanctuaryInfo?.deities ? `■ 御祭神: ${sanctuaryInfo.deities}` : '',
    sanctuaryInfo?.address ? `■ 所在地: ${sanctuaryInfo.address}` : '',
    sanctuaryInfo ? '' : '',
    '【チャプター / 目次】',
    ...timestamps,
    '',
    '----------------------------------------',
    '心静かにご参拝ください。よろしければ高評価・チャンネル登録をお願いいたします。',
    '#神社巡り #聖地巡礼 #パワースポット #参拝 #日本の美',
  ].filter(line => line !== null && line !== undefined);

  return lines.join('\n');
}
