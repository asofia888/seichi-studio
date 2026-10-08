/**
 * Automatic editing from real video files: recording order, talking, place, Claude's text, and undo
 */
import type { Page } from '@playwright/test';
import type { ProjectData } from '../src/types';
import { expect, expectSaved, openTab, pressShortcut, savedProject, startEmptyProject, test, titleInput } from './app';
import { makeVideos, type TestVideo } from './videos';

test.describe.configure({ timeout: 180_000 });

// File names deliberately not in recording order, so the order must come from the recording times
const VIDEOS: TestVideo[] = [
  { name: '2_大鳥居.mp4', seconds: 12, color: '#c62828', recordedAt: '2026-10-01T00:10:00Z', location: '+36.7428+138.0853/' },
  { name: '3_参道.mp4', seconds: 12, color: '#2e7d32', recordedAt: '2026-10-01T00:25:00Z' },
  { name: '1_拝殿.mp4', seconds: 12, color: '#1565c0', recordedAt: '2026-10-01T00:40:00Z', speech: [4, 7] },
];
const RECORDING_ORDER = ['2_大鳥居', '3_参道', '1_拝殿'];
const SHRINE = '戸隠神社 奥社';

let files: Awaited<ReturnType<typeof makeVideos>>;
test.beforeAll(async ({ browser }) => {
  files = await makeVideos(browser, VIDEOS);
});

async function runAutoEdit(page: Page, notes?: string) {
  await page.getByRole('button', { name: 'おまかせ編集', exact: true }).click();
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(files);
  await expect(page.getByText('3 本の動画')).toBeVisible();
  await page.getByPlaceholder('例: 戸隠神社 奥社').fill(SHRINE);
  if (notes) await page.getByPlaceholder(/例: 御祭神は/).fill(notes);
  await page.getByRole('button', { name: 'おまかせ編集を開始' }).click();
  await expect(page.getByText('下書きができました')).toBeVisible({ timeout: 150_000 });
}

/** The edited project, once it has been saved */
async function editedProject(page: Page): Promise<ProjectData> {
  await expectSaved(page, (p) => p.videoClips.length > 0, 'おまかせ編集の結果が保存される');
  const project = (await savedProject(page))!;
  project.videoClips.sort((a, b) => a.startTime - b.startTime);
  return project;
}

test('動画を入れると、撮影順に並び、話している部分を残した下書きになる（Claude なし）', async ({ page }) => {
  await startEmptyProject(page, '元のプロジェクト');
  await runAutoEdit(page);

  await expect(page.getByText('3 / 3 本')).toBeVisible();
  await expect(page.getByText('撮影日時の順', { exact: true })).toBeVisible();
  await expect(page.getByText('1 本（声の部分は切らずに残しました）')).toBeVisible();
  await expect(page.getByText('撮影場所の座標で作成')).toBeVisible();

  const project = await editedProject(page);
  expect(project.title).toBe(`${SHRINE} 参拝紀行`);
  expect(project.videoClips.map((c) => c.name)).toEqual(RECORDING_ORDER);

  // All the footage fits in the target (1 minute), minus the shaky first and last moments, back to back
  let t = 0;
  for (const clip of project.videoClips) {
    expect(clip.startTime).toBeCloseTo(t, 1);
    expect(clip.trimStart).toBeCloseTo(0.6, 1);
    expect(clip.trimEnd).toBeCloseTo(11.4, 1);
    t += clip.duration;
  }

  // Talking was found in the sound of 拝殿 only, where the voice-like sound plays (4 s to 7 s)
  const [torii, approach, hall] = project.videoClips;
  expect(hall.speechRanges).toHaveLength(1);
  const [speechStart, speechEnd] = hall.speechRanges![0];
  expect(speechStart).toBeGreaterThan(3);
  expect(speechStart).toBeLessThan(4.5);
  expect(speechEnd).toBeGreaterThan(6.5);
  expect(speechEnd).toBeLessThan(8);
  expect(torii.speechRanges ?? []).toHaveLength(0);
  expect(approach.speechRanges ?? []).toHaveLength(0);
  // The talking keeps its full volume; scenery sound stays in a little lower
  expect([torii.volume, approach.volume, hall.volume]).toEqual([0.7, 0.7, 1]);

  // A name card, and an access card at the place the first video was recorded
  expect(project.subtitles.map((s) => [s.category, s.text.ja])).toEqual([['sanctuary_header', SHRINE]]);
  expect(project.accessCards).toHaveLength(1);
  expect(project.accessCards[0].latLng).toEqual({ lat: 36.7428, lng: 138.0853 });

  // The whole edit is one undo step
  await page.getByRole('button', { name: '閉じる' }).click();
  await pressShortcut(page, 'Control+z');
  await expect(titleInput(page)).toHaveValue('元のプロジェクト');
  await expectSaved(page, (p) => p.videoClips.length === 0, '元に戻すと、元のタイムラインに戻る');
});

test('Claude の下書きが、聖地名カード・テロップ・作法・チャプター・案内になる', async ({ page }) => {
  const requests: any[] = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    requests.push(route.request().postDataJSON());
    const blank = { ja: '', en: '' };
    const script = {
      videoTitle: { ja: '戸隠神社 奥社 杉並木を歩く', en: 'Walking the Cedar Avenue of Togakushi' },
      sanctuary: {
        name: { ja: SHRINE, en: 'Togakushi Shrine Okusha' },
        location: { ja: '長野県長野市', en: 'Nagano City, Nagano' },
        deity: { ja: '天手力雄命', en: 'Ame-no-Tajikarao-no-Mikoto' },
        blessing: { ja: '開運', en: 'Good fortune' },
      },
      access: { address: { ja: '長野県長野市戸隠', en: 'Togakushi, Nagano City' }, nearestStation: blank, parking: blank, visitingHours: blank },
      clips: [
        { index: 1, scene: '大鳥居', telop: 'commentary', text: { ja: '朱の大鳥居をくぐる', en: 'Beneath the great torii' }, tipTitle: blank, chapter: { ja: '大鳥居', en: 'The Great Torii' } },
        { index: 2, scene: '参道', telop: 'etiquette', text: { ja: '参道の中央は神様の通り道', en: 'The center belongs to the deity' }, tipTitle: { ja: '参道の歩き方', en: 'Walking the Approach' }, chapter: { ja: '参道', en: 'The Approach' } },
        { index: 3, scene: '拝殿', telop: 'none', text: blank, tipTitle: blank, chapter: { ja: '拝殿', en: 'The Hall of Worship' } },
      ],
      glossary: [{ japanese: '天手力雄命', english: 'Ame-no-Tajikarao-no-Mikoto' }],
    };
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(script) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 3000, output_tokens: 800 },
      }),
    });
  });

  await startEmptyProject(page, '元のプロジェクト');
  await openTab(page, '翻訳');
  await page.getByPlaceholder('sk-ant-api03-...').fill('sk-ant-api03-test-key');
  await page.getByPlaceholder('sk-ant-api03-...').locator('..').getByRole('button', { name: '保存' }).click();
  await runAutoEdit(page, '御祭神は天手力雄命。');

  // Claude saw one frame of each part of the visit, in order, with the notes and which part has talking
  expect(requests).toHaveLength(1);
  const content = requests[0].messages[0].content as { type: string; text?: string }[];
  expect(content.filter((b) => b.type === 'image')).toHaveLength(3);
  const text = content.flatMap((b) => (b.text ? [b.text] : [])).join('\n');
  expect(text).toContain(`Shrine: ${SHRINE}`);
  expect(text).toContain('御祭神は天手力雄命。');
  expect(text).toMatch(/クリップ3（[\d.]+秒・撮影者の話し声あり）/);

  await expect(page.getByText('2 件と聖地名カード')).toBeVisible();
  const project = await editedProject(page);
  expect(project.title).toBe('戸隠神社 奥社 杉並木を歩く');

  const [header, commentary, etiquette] = [...project.subtitles].sort((a, b) => a.startTime - b.startTime);
  expect(header.category).toBe('sanctuary_header');
  expect(header.sanctuaryMeta!.deity).toEqual({ ja: '天手力雄命', en: 'Ame-no-Tajikarao-no-Mikoto' });
  // Each caption sits on its own clip, after the name card
  const [torii, approach] = project.videoClips;
  expect(commentary).toMatchObject({ category: 'commentary', text: { ja: '朱の大鳥居をくぐる' } });
  expect(commentary.startTime).toBeGreaterThanOrEqual(header.startTime + header.duration);
  expect(commentary.startTime + commentary.duration).toBeLessThanOrEqual(torii.startTime + torii.duration);
  expect(etiquette).toMatchObject({ category: 'etiquette_tip', etiquetteTip: { title: { ja: '参道の歩き方' } } });
  expect(etiquette.startTime).toBeGreaterThanOrEqual(approach.startTime);
  expect(etiquette.startTime + etiquette.duration).toBeLessThanOrEqual(approach.startTime + approach.duration);

  // One chapter per part, the first at 0:00, each at least 10 seconds long
  expect(project.chapters.map((c) => c.title.ja)).toEqual(['大鳥居', '参道', '拝殿']);
  expect(project.chapters[0].timeSec).toBe(0);
  expect(project.accessCards[0].address.ja).toBe('長野県長野市戸隠');
  expect(project.glossary.map((g) => g.japanese)).toContain('天手力雄命');
});
