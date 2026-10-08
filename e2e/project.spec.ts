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
  expect(body.system).toContain(initialProjectData.glossary[0].japanese);
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
