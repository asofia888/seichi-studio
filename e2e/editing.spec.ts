/**
 * Editing on the timeline and with the keyboard, mostly starting from the sample project
 */
import type { Page } from '@playwright/test';
import { makePng, makeWav } from './media';
import {
  addPhotos,
  expect,
  expectSaved,
  openApp,
  openTab,
  playheadTime,
  pressShortcut,
  redoButton,
  savedProject,
  seek,
  startEmptyProject,
  test,
  timeline,
  titleInput,
  undoButton,
} from './app';

const FIRST_CLIP = '大鳥居と参道入口'; // 3 s to 13 s in the sample project
const LAST_CLIP = '奥社本殿と拝殿';

const RED_PHOTO = { name: '朱の鳥居.png', png: makePng([200, 30, 30]) };
const BLUE_PHOTO = { name: '青い空.png', png: makePng([30, 60, 200]) };

/** Colour of the preview at (x, y), given as fractions of its width and height */
async function previewPixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.getByRole('img', { name: 'プレビュー' }).evaluate((canvas: HTMLCanvasElement, [x, y]) => {
    const ctx = canvas.getContext('2d')!;
    return Array.from(ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data.slice(0, 3));
  }, [x, y]);
}

test('クリップを選ぶだけでは「元に戻す」に記録されない', async ({ page }) => {
  await openApp(page);
  await expect(undoButton(page)).toBeDisabled();

  await timeline(page).getByTitle(FIRST_CLIP, { exact: true }).click();
  await expect(timeline(page).getByRole('button', { name: '削除', exact: true })).toBeVisible();
  await expect(undoButton(page)).toBeDisabled();
});

test('S で再生位置の分割、Ctrl+Z で元に戻し、Ctrl+Y でやり直す', async ({ page }) => {
  await openApp(page);
  await timeline(page).getByTitle(FIRST_CLIP, { exact: true }).click();
  await seek(page, 8);

  await pressShortcut(page, 's');
  const secondPiece = timeline(page).getByTitle(`${FIRST_CLIP} (分割)`, { exact: true });
  await expect(secondPiece).toBeVisible();
  await expectSaved(page, (p) => p.videoClips.length === 4, '分割したクリップが保存される');
  const pieces = (await savedProject(page))!.videoClips.filter((c) => c.name.startsWith(FIRST_CLIP));
  expect(pieces.map((c) => [c.startTime, c.duration])).toEqual([[3, 5], [8, 5]]);
  expect(pieces[1].trimStart - pieces[0].trimStart).toBe(5); // the second piece continues the same footage

  await pressShortcut(page, 'Control+z');
  await expect(secondPiece).toHaveCount(0);
  await pressShortcut(page, 'Control+y');
  await expect(secondPiece).toBeVisible();
  await expect(redoButton(page)).toBeDisabled();
});

test('再生位置がクリップの外なら分割せず、理由を表示する', async ({ page }) => {
  await openApp(page);
  await timeline(page).getByTitle(FIRST_CLIP, { exact: true }).click();
  await seek(page, 20);

  await pressShortcut(page, 's');
  await expect(page.getByRole('status')).toContainText('分割できません');
  await expect(timeline(page).getByTitle(`${FIRST_CLIP} (分割)`)).toHaveCount(0);
});

test('Delete で削除し、元に戻すボタンで戻せる', async ({ page }) => {
  await openApp(page);
  const clip = timeline(page).getByTitle(LAST_CLIP, { exact: true });
  await clip.click();

  await pressShortcut(page, 'Delete');
  await expect(clip).toHaveCount(0);
  await undoButton(page).click();
  await expect(clip).toBeVisible();
});

test('クリップを削除すると後ろが詰まり、隙間ができない', async ({ page }) => {
  await openApp(page);
  await timeline(page).getByTitle(FIRST_CLIP, { exact: true }).click();
  await pressShortcut(page, 'Delete');

  await expectSaved(
    page,
    (p) => p.videoClips.find((c) => c.name === '樹齢四百年の杉並木と随神門')?.startTime === 3 && p.duration === 35,
    '次のクリップが削除した位置（3秒）に詰まり、動画も10秒短くなる'
  );
  await undoButton(page).click();
  await expectSaved(page, (p) => p.videoClips.length === 3 && p.duration === 45, '元に戻すと位置も戻る');
});

test('隣り合ったクリップは、ドラッグしても重ならない', async ({ page }) => {
  await openApp(page);
  const second = timeline(page).getByTitle('樹齢四百年の杉並木と随神門', { exact: true });
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => (await second.boundingBox())!.x, { message: '前のクリップに食い込まない' }).toBeCloseTo(box.x, 0);
  await expect(undoButton(page)).toBeDisabled(); // nothing moved, so nothing to undo
});

test('入力欄で文字を打っても、ショートカットは反応しない', async ({ page }) => {
  await openApp(page);
  // A selected clip: S would split it and Delete/Backspace would remove it if shortcuts leaked through
  await timeline(page).getByTitle(FIRST_CLIP, { exact: true }).click();
  await seek(page, 8);

  const title = titleInput(page);
  await title.fill('');
  await title.pressSequentially('Seichi R ?');
  await title.press('Backspace');
  await title.press('Delete');

  await expect(title).toHaveValue('Seichi R ');
  await expect(timeline(page).getByTitle(FIRST_CLIP, { exact: true })).toBeVisible();
  await expect(timeline(page).getByTitle(`${FIRST_CLIP} (分割)`)).toHaveCount(0);
  await expect(page.getByText('キーボードショートカット一覧')).toHaveCount(0);
  await expect(page.getByText('ナレーション録音中...')).toHaveCount(0);
  await expect(playheadTime(page)).toHaveText('00:08.0'); // Space did not start playback
});

test('? でショートカット一覧を開き、Esc で閉じる', async ({ page }) => {
  await openApp(page);
  await pressShortcut(page, '?');
  await expect(page.getByText('キーボードショートカット一覧')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('キーボードショートカット一覧')).toHaveCount(0);
});

test('Space で再生と一時停止', async ({ page }) => {
  await openApp(page);
  await pressShortcut(page, 'Space');
  await expect(playheadTime(page)).not.toHaveText('00:00.0');

  await pressShortcut(page, 'Space');
  const stoppedAt = await playheadTime(page).textContent();
  await page.waitForTimeout(500);
  await expect(playheadTime(page)).toHaveText(stoppedAt!);
});

test('テロップを追加して文章を直すと、タイムラインと保存データに反映される', async ({ page }) => {
  await openApp(page);
  await seek(page, 20);
  await openTab(page, 'テロップ');
  await page.getByRole('button', { name: /② 解説テロップ/ }).click();

  const text = page.locator('label', { hasText: '解説テキスト (日本語)' }).locator('xpath=following-sibling::textarea[1]');
  await text.fill('苔むした石段を一歩ずつ');
  await expect(timeline(page).getByTitle('苔むした石段を一歩ずつ', { exact: true })).toBeVisible();
  await expectSaved(
    page,
    (p) => p.subtitles.some((s) => s.text.ja === '苔むした石段を一歩ずつ' && s.startTime === 20 && s.category === 'commentary'),
    '追加したテロップが保存される'
  );
});

test('録音（R キー）でナレーションが入り、録音後も操作が止まらない', async ({ page }) => {
  await openApp(page);
  await seek(page, 30);

  await pressShortcut(page, 'r');
  await expect(page.getByText('ナレーション録音中...')).toBeVisible();
  await page.waitForTimeout(2000);
  await pressShortcut(page, 'r');

  await expect(page.getByText('ナレーション録音中...')).toHaveCount(0);
  await expect(timeline(page).getByTitle('録音 (30.0s) 🎙️', { exact: true })).toBeVisible();
  await expectSaved(
    page,
    (p) => p.audioTracks.some((a) => a.isRecorded && a.startTime === 30 && a.duration >= 1.5 && !!a.blobKey),
    '録音したナレーションが保存される'
  );

  // The app keeps responding after a recording
  await pressShortcut(page, 'Home');
  await pressShortcut(page, 'Space');
  await expect(playheadTime(page)).not.toHaveText('00:00.0');
  await pressShortcut(page, 'Space');
});

test('縦 9:16 に切り替えると、書き出しサイズも縦になる', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '横 16:9 通常' }).click();
  await expect(page.getByRole('button', { name: '縦 9:16 ショート' })).toBeVisible();

  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  await expect(page.getByText('9:16 (1080 x 1920)')).toBeVisible();
});

test('最後の写真を消すと動画が短くなり、BGM も合わせて短くなる（元に戻すと戻る）', async ({ page }) => {
  await startEmptyProject(page, '総尺テスト');
  await addPhotos(page, [RED_PHOTO, BLUE_PHOTO]); // 3-11 s and 11-19 s, no ending card
  await openTab(page, '音声');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /手持ちのBGM音源/ }).click();
  await (await choosing).setFiles({ name: '雅楽.wav', mimeType: 'audio/wav', buffer: makeWav(440, 30, 0.5) });
  await expectSaved(page, (p) => p.duration === 19 && p.audioTracks[0]?.duration === 19, 'BGM は動画の終わりまで');

  await timeline(page).getByTitle('青い空', { exact: true }).click();
  await pressShortcut(page, 'End');
  await pressShortcut(page, 'Delete');
  await expectSaved(
    page,
    (p) => p.duration === 11 && p.audioTracks[0].duration === 11,
    '動画と BGM が、残った写真の終わりまで短くなる'
  );
  await expect(playheadTime(page)).toHaveText('00:11.0'); // the playhead stays inside the video

  await undoButton(page).click();
  await expectSaved(page, (p) => p.duration === 19 && p.audioTracks[0].duration === 19, '元に戻すと長さも戻る');
});

test('写真・動画のない部分は、プレビューでそう知らせる（画面に文字は描かない）', async ({ page }) => {
  await startEmptyProject(page, '隙間テスト');
  await expect(page.getByText('「素材」タブから写真・動画を追加してください')).toBeVisible();

  await addPhotos(page, [RED_PHOTO]); // 3-11 s, nothing before it
  const notice = page.getByText(/ここには写真・動画がありません/);
  await seek(page, 1);
  await expect(notice).toBeVisible();
  expect((await previewPixel(page, 0.5, 0.55)).every((v) => v < 30), 'プレビューの絵は黒いまま').toBe(true);

  await seek(page, 6);
  await expect(notice).toHaveCount(0);
});

test('周辺減光は弱めたり切ったりでき、元に戻せる', async ({ page }) => {
  await startEmptyProject(page, '周辺減光テスト');
  await addPhotos(page, [RED_PHOTO]);
  await seek(page, 6);
  const edgeRed = async () => (await previewPixel(page, 0.005, 0.5))[0];
  await expect.poll(edgeRed, { message: '最初は画面の左右の端が暗い' }).toBeLessThan(100);

  await page.getByLabel('周辺減光（画面の四隅を暗くする）').fill('0');
  await expect.poll(edgeRed, { message: '切ると端まで写真の色のまま' }).toBeGreaterThan(180);
  await expectSaved(page, (p) => p.vignette === 0, '設定が保存される');

  await undoButton(page).click();
  await expect.poll(edgeRed, { message: '元に戻すと端がまた暗くなる' }).toBeLessThan(100);
});
