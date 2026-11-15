/**
 * Keeping work: saving in the browser, project files, presets, and the Claude translation
 */
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { initialProjectData, izumoProjectData } from '../src/services/sampleData';
import { makePng } from './media';
import {
  addPhotos,
  expect,
  expectSaved,
  openApp,
  openProjects,
  openTab,
  seek,
  startEmptyProject,
  test,
  timeline,
  titleInput,
  undoButton,
} from './app';

/** Colour of the middle of the preview */
async function previewCenter(page: Page): Promise<number[]> {
  return page.getByRole('img', { name: 'プレビュー' }).evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return Array.from(ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data.slice(0, 3));
  });
}

test('再読み込みしても、編集内容と写真が残る', async ({ page }) => {
  await startEmptyProject(page);
  await addPhotos(page, [{ name: '朱の鳥居.png', png: makePng([200, 30, 30]) }]);
  await titleInput(page).fill('再読み込みテスト');
  await expectSaved(page, (p) => p.title === '再読み込みテスト' && p.videoClips.length === 1, '編集が保存される');

  await page.reload();
  await expect(titleInput(page)).toHaveValue('再読み込みテスト');
  await expect(timeline(page).getByTitle('朱の鳥居', { exact: true })).toBeVisible();

  // The photo itself came back (not just its name): the preview shows red over the clip
  await seek(page, 6);
  await expect.poll(async () => {
    const [r, g, b] = await previewCenter(page);
    return r > 120 && g < 80 && b < 80;
  }, { message: 'プレビューに赤い写真が映る' }).toBe(true);
});

test('プロジェクトファイルに保存して読み込むと元に戻り、API キーは含まれない', async ({ page }) => {
  await openApp(page);
  // An API key saved in this browser must never end up in a file meant for sharing
  await openTab(page, '翻訳');
  await page.getByPlaceholder('sk-ant-api03-...').fill('sk-ant-api03-SECRET-TEST-KEY');
  await page.getByPlaceholder('sk-ant-api03-...').locator('..').getByRole('button', { name: '保存' }).click();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).first().click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${initialProjectData.title}.sacred.json`);
  const fileText = readFileSync(await download.path());
  expect(fileText.toString()).not.toContain('SECRET-TEST-KEY');
  expect(JSON.parse(fileText.toString()).title).toBe(initialProjectData.title);

  await titleInput(page).fill('書き換えたタイトル');
  // Edits within 0.8 s undo together; picking a file in a dialog always takes longer than that
  await page.waitForTimeout(1000);
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: fileText,
  });
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);

  // Loading a file can be undone
  await undoButton(page).click();
  await expect(titleInput(page)).toHaveValue('書き換えたタイトル');
});

test('壊れたプロジェクトファイルを読み込むと、編集中の内容を残したままエラーを表示する', async ({ page }) => {
  await openApp(page);
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"title": '),
  });
  await expect(page.getByRole('alert')).toContainText('プロジェクトファイルの読み込みに失敗しました');
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);
});

test('項目の欠けたプロジェクトファイルは補って読み込み、プロジェクトでないファイルは断る', async ({ page }) => {
  await openApp(page);
  const fileInput = page.locator('input[type=file][accept=".json"]');
  const jsonFile = (name: string, content: unknown) => ({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(content)),
  });

  // JSON from somewhere else that happens to have a title: refused, and the editor is untouched
  await fileInput.setInputFiles(jsonFile('other.json', { title: '別のソフトのファイル' }));
  await expect(page.getByRole('alert').filter({ hasText: '読み込みに失敗しました' })).toBeVisible();
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);

  // A project with most of it missing and one clip that cannot be placed: loaded without them
  await fileInput.setInputFiles(
    jsonFile('partial.sacred.json', {
      title: '途中まで',
      videoClips: [
        { id: 'ok', name: '残る写真', type: 'image', startTime: 0, duration: 5 },
        { id: 'broken', name: '壊れた写真', type: 'image', startTime: 'abc', duration: null },
      ],
    })
  );
  await expect(titleInput(page)).toHaveValue('途中まで');
  await expect(timeline(page).getByTitle('残る写真', { exact: true })).toBeVisible();
  await expect(timeline(page).getByTitle('壊れた写真')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '1 件' })).toBeVisible();
  await expectSaved(
    page,
    (p) => p.title === '途中まで' && p.duration === 5 && p.subtitles.length === 0 && p.audioTracks.length === 0,
    '欠けていた項目が補われ、長さも正しく保存される'
  );

  // The editor carries on working
  await undoButton(page).click();
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);
});

test('画面の表示に失敗しても真っ白にならず、プロジェクトを残したまま開き直せる', async ({ page }) => {
  // The preview fails to draw while this flag is set, which stops the whole editor
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (localStorage.getItem('e2e_break_canvas')) throw new Error('プレビューを描画できません');
      return (getContext as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof getContext;
  });
  await openApp(page);
  await titleInput(page).fill('止まる前の作品');
  await expectSaved(page, (p) => p.title === '止まる前の作品', '編集が保存される');

  await page.evaluate(() => localStorage.setItem('e2e_break_canvas', '1'));
  await page.reload();
  const errorScreen = page.getByRole('alert');
  await expect(errorScreen).toContainText('画面の表示中に問題が起きました');
  await expect(errorScreen).toContainText('プレビューを描画できません');
  await expect(errorScreen.getByRole('button', { name: '再読み込み' })).toBeVisible();

  // Opening without the project: the app starts on the sample, and the work is still in the list
  await page.evaluate(() => localStorage.removeItem('e2e_break_canvas'));
  await errorScreen.getByRole('button', { name: 'サンプルの状態で開き直す' }).click();
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);
  const projects = await openProjects(page);
  await expect(projects.getByRole('listitem').filter({ hasText: '止まる前の作品' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Several projects in one browser, and backups that carry their media
// ---------------------------------------------------------------------------

test('プロジェクトを新しく作って切り替えても、それぞれの内容が残る', async ({ page }) => {
  await openApp(page);
  await titleInput(page).fill('一つ目の動画');

  let projects = await openProjects(page);
  await expect(projects.getByRole('listitem').filter({ hasText: '一つ目の動画' })).toContainText('編集中');
  await projects.getByRole('button', { name: '新しいプロジェクト' }).click();
  await expect(projects).toHaveCount(0);
  await expect(titleInput(page)).toHaveValue('新しいプロジェクト');
  await expect(undoButton(page)).toBeDisabled(); // a new project cannot be undone into the previous one

  await addPhotos(page, [{ name: '朱の鳥居.png', png: makePng([200, 30, 30]) }]);
  await titleInput(page).fill('二つ目の動画');
  await expectSaved(page, (p) => p.title === '二つ目の動画' && p.videoClips.length === 1, '新しいプロジェクトが保存される');

  // The project open last is the one that comes back
  await page.reload();
  await expect(titleInput(page)).toHaveValue('二つ目の動画');

  projects = await openProjects(page);
  await expect(projects.getByRole('listitem')).toHaveCount(2);
  await projects.getByRole('listitem').filter({ hasText: '一つ目の動画' }).getByRole('button', { name: '開く' }).click();
  await expect(titleInput(page)).toHaveValue('一つ目の動画');
  await expect(timeline(page).getByTitle('大鳥居と参道入口', { exact: true })).toBeVisible();
  await expect(timeline(page).getByTitle('朱の鳥居', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(titleInput(page)).toHaveValue('一つ目の動画');
  projects = await openProjects(page);
  await projects.getByRole('listitem').filter({ hasText: '二つ目の動画' }).getByRole('button', { name: '開く' }).click();
  await expect(timeline(page).getByTitle('朱の鳥居', { exact: true })).toBeVisible();
});

test('プロジェクトを複製・削除できる（編集中のものは削除できない）', async ({ page }) => {
  await openApp(page);
  await titleInput(page).fill('横の動画');
  const projects = await openProjects(page);
  const rows = projects.getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: '削除' })).toBeDisabled();

  await rows.first().getByRole('button', { name: '複製' }).click();
  const copy = rows.filter({ hasText: '横の動画 のコピー' });
  await expect(copy).toBeVisible();

  // Deleting asks first
  await copy.getByRole('button', { name: '削除' }).click();
  await copy.getByRole('button', { name: 'やめる' }).click();
  await expect(copy).toBeVisible();
  await copy.getByRole('button', { name: '削除' }).click();
  await copy.getByRole('button', { name: '削除する' }).click();
  await expect(rows).toHaveCount(1);
  await expect(titleInput(page)).toHaveValue('横の動画');
});

test('バックアップは写真ごと別のブラウザへ持ち出せる', async ({ page, browser, baseURL, viewport }) => {
  await startEmptyProject(page, '持ち出すプロジェクト');
  await addPhotos(page, [{ name: '朱の鳥居.png', png: makePng([200, 30, 30]) }]);
  await expectSaved(page, (p) => p.videoClips.length === 1, '写真が保存される');

  const projects = await openProjects(page);
  const downloading = page.waitForEvent('download');
  await projects.getByRole('button', { name: 'バックアップ', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('持ち出すプロジェクト.sacred.zip');
  const backupFile = readFileSync(await download.path());
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();

  // Another browser: nothing of this project is stored there
  const otherBrowser = await browser.newContext({ baseURL, viewport });
  try {
    const other = await otherBrowser.newPage();
    await openApp(other, initialProjectData.title);
    const otherProjects = await openProjects(other);
    await otherProjects.locator('input[type=file]').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/zip',
      buffer: backupFile,
    });
    await expect(titleInput(other)).toHaveValue('持ち出すプロジェクト');
    await expect(otherProjects).toHaveCount(0);
    await expect(timeline(other).getByTitle('朱の鳥居', { exact: true })).toBeVisible();

    // The photo itself came along (not just its name)
    await seek(other, 6);
    await expect.poll(async () => {
      const [r, g, b] = await previewCenter(other);
      return r > 120 && g < 80 && b < 80;
    }, { message: 'プレビューに赤い写真が映る' }).toBe(true);

    // The sample project that was open is still there, next to the restored one
    await expect((await openProjects(other)).getByRole('listitem')).toHaveCount(2);
  } finally {
    await otherBrowser.close();
  }
});

test('バックアップでないファイルを読み込むと、今のプロジェクトを残したままエラーを表示する', async ({ page }) => {
  await openApp(page);
  const projects = await openProjects(page);
  await projects.locator('input[type=file]').setInputFiles({
    name: 'photos.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('this is not a backup'),
  });
  await expect(page.getByRole('alert')).toContainText('このアプリのバックアップ');
  await expect(projects.getByRole('listitem')).toHaveCount(1);
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);
});

test('聖地プリセットは確認してから読み込む', async ({ page }) => {
  await openApp(page);
  const presets = page.getByTitle('神社・聖地プリセットを読み込み');

  page.once('dialog', (dialog) => dialog.dismiss());
  await presets.selectOption('izumo');
  await expect(titleInput(page)).toHaveValue(initialProjectData.title);

  page.once('dialog', (dialog) => dialog.accept());
  await presets.selectOption('izumo');
  await expect(titleInput(page)).toHaveValue(izumoProjectData.title);
});

// ---------------------------------------------------------------------------
// Claude translation, with the API answered by the test (no key, no cost, no network)
// ---------------------------------------------------------------------------

const API_KEY = 'sk-ant-api03-test-key';

async function answerClaude(page: Page, reply: (route: Route) => Promise<void>) {
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        },
      });
      return;
    }
    await reply(route);
  });
}

async function saveApiKey(page: Page) {
  await openTab(page, '翻訳');
  await page.getByPlaceholder('sk-ant-api03-...').fill(API_KEY);
  await page.getByPlaceholder('sk-ant-api03-...').locator('..').getByRole('button', { name: '保存' }).click();
}

test('Claude 翻訳の結果が、その行の英語欄に入る', async ({ page }) => {
  const requests: { headers: Record<string, string>; body: any }[] = [];
  await answerClaude(page, async (route) => {
    requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify({ en: 'The great torii at the entrance' }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    });
  });
  await openApp(page);
  await saveApiKey(page);

  await page.getByRole('button', { name: 'この行だけ再翻訳' }).first().click();
  await expect(page.getByPlaceholder('English translation...').first()).toHaveValue('The great torii at the entrance');

  // What was sent: the saved key, the chosen model, the line and the glossary
  expect(requests).toHaveLength(1);
  const [{ headers, body }] = requests;
  expect(headers['x-api-key']).toBe(API_KEY);
  expect(body.model).toBe('claude-opus-5-5');
  expect(JSON.stringify(body.messages)).toContain(initialProjectData.subtitles[0].text.ja);
  expect(JSON.stringify(body.system)).toContain(initialProjectData.glossary[0].japanese);
});

test('一括翻訳は全テロップを1回の依頼で送り、それぞれの英語欄に入る', async ({ page }) => {
  const requests: any[] = [];
  await answerClaude(page, async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    // Answer every line that was sent, by its id
    const sent = JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('[')));
    const translations = sent.map((line: { id: string }, i: number) => ({ id: line.id, en: `Line ${i + 1}` }));
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_batch',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify({ translations }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 300, output_tokens: 80 },
      }),
    });
  });
  await openApp(page);
  await saveApiKey(page);

  await page.getByRole('button', { name: /全テロップを一括翻訳/ }).click();
  await expect(page.getByText('すべての解説テロップの英語翻訳が完了しました！')).toBeVisible();
  expect(requests, '1回の依頼にまとまる').toHaveLength(1);
  const lineCount = initialProjectData.subtitles.filter((s) => s.text.ja.trim()).length;
  await expectSaved(
    page,
    (p) => p.subtitles.filter((s) => /^Line \d+$/.test(s.text.en)).length === lineCount,
    'すべての行の英語欄に、その行の訳が入る'
  );
  // The system prompt (with the glossary) is marked for caching
  expect(requests[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
});

test('API キーが拒否されたら、分かる言葉でエラーを表示する', async ({ page }) => {
  await answerClaude(page, (route) =>
    route.fulfill({
      status: 401,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    })
  );
  await openApp(page);
  await saveApiKey(page);
  const english = page.getByPlaceholder('English translation...').first();
  const before = await english.inputValue();

  await page.getByRole('button', { name: 'この行だけ再翻訳' }).first().click();
  await expect(page.getByRole('alert')).toContainText('APIキーが正しくありません');
  await expect(english).toHaveValue(before);
});
