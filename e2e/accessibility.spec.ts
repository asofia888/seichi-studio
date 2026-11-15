/**
 * Accessibility: an automatic check of every panel and dialog (names, roles, contrast), and
 * using the editor with the keyboard alone
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, expectSaved, openApp, openTab, playheadTime, savedProject, test, timeline } from './app';

const FIRST_CLIP = '大鳥居と参道入口'; // 3 s to 13 s in the sample project

/** Fail with a readable list of what the automatic check (axe, WCAG 2.1 A and AA) finds in `scope` */
async function expectNoProblems(page: Page, where: string, scope = 'body') {
  const { violations } = await new AxeBuilder({ page })
    .include(scope)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const problems = violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}\n    ${n.html.slice(0, 160)}\n    ${(n.failureSummary ?? '').split('\n').slice(1, 3).join(' / ').trim()}`)
  );
  // Soft: one run lists what is wrong everywhere, not only in the first place it looks
  expect.soft(problems, `${where}に自動検査で見つかる問題がないこと`).toEqual([]);
}

test('どのタブの画面にも、自動検査で見つかる問題がない（選択中の編集欄も含む）', async ({ page }) => {
  test.setTimeout(180_000); // a dozen full checks of the page
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  for (const tab of ['素材', 'テロップ', '翻訳', '地図', '音声', '目次'] as const) {
    await openTab(page, tab);
    await expectNoProblems(page, `「${tab}」タブ`);
  }

  // With something selected, the panels show their editing fields
  await timeline(page).getByTitle(FIRST_CLIP, { exact: true }).click();
  await expectNoProblems(page, 'クリップを選んだ「素材」タブ');
  for (const [kind, name] of [['テロップ', /^テロップ「/], ['音声', /^(ナレーション|BGM|環境音)「/]] as const) {
    const items = timeline(page).getByRole('button', { name });
    expect(await items.count(), `タイムラインに${kind}がある`).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(3, await items.count()); i++) {
      await items.nth(i).click();
      await expectNoProblems(page, `${kind}（${i + 1} 個目）を選んだ「${kind}」タブ`);
    }
  }
});

test('どのダイアログにも、自動検査で見つかる問題がない', async ({ page }) => {
  await openApp(page);
  for (const [button, dialogName] of [
    ['プロジェクト', 'プロジェクト'],
    ['おまかせ編集', 'おまかせ編集'],
    ['サムネイル', 'サムネイル作成'],
    ['書き出し', '動画書き出し'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();
    await expectNoProblems(page, `「${dialogName}」ダイアログ`, '[role="dialog"]');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'キーボードショートカット一覧' })).toBeVisible();
  await expectNoProblems(page, 'ショートカット一覧', '[role="dialog"]');
});

test('ダイアログを開くとフォーカスが中に入り、Tab で外に出ず、閉じると元のボタンに戻る', async ({ page }) => {
  await openApp(page);
  const opener = page.getByRole('button', { name: '書き出し', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '動画書き出し' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();

  // Tab goes round inside the dialog, in both directions, however often it is pressed
  const handle = await dialog.elementHandle();
  const focusIsInside = () => page.evaluate((root) => !!root && root.contains(document.activeElement) && document.activeElement !== root, handle);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await focusIsInside(), `Tab ${i + 1} 回目もダイアログの中`).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusIsInside(), `Shift+Tab ${i + 1} 回目もダイアログの中`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('タブは矢印キーで切り替えられ、キーボードで選んだボタンは Space で押せる（再生は K）', async ({ page }) => {
  await openApp(page);
  const tab = (name: string) => page.getByRole('tab', { name });
  await expect(tab('テロップ')).toHaveAttribute('aria-selected', 'true');

  // Reach the tabs with the keyboard, then move along them
  await tab('テロップ').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tab('テロップ')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab('翻訳')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('翻訳')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(tab('素材')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab('目次')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '目次' })).toBeVisible();
  await expect(playheadTime(page), '矢印キーは再生位置を動かしていない').toHaveText('00:00.0');

  // Space on a button reached with the keyboard presses that button instead of starting playback
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(tab('素材')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(400);
  await expect(playheadTime(page), 'Space で再生は始まらない').toHaveText('00:00.0');

  // K plays and pauses from anywhere
  await page.keyboard.press('k');
  await expect(playheadTime(page)).not.toHaveText('00:00.0');
  await page.keyboard.press('k');
  const stoppedAt = await playheadTime(page).textContent();
  await page.waitForTimeout(400);
  await expect(playheadTime(page)).toHaveText(stoppedAt!);
});

test('タイムラインのアイテムはキーボードで選べて、Alt+矢印で動かし、Alt+Shift+矢印で長さを変えられる', async ({ page }) => {
  await openApp(page);
  // The first telop of the sample project, and where it is, as the timeline says it
  const item = timeline(page).getByRole('button', { name: /^テロップ「/ }).first();
  await expect(item).toHaveAttribute('aria-pressed', 'false');
  const [, text, start, length] = (await item.getAttribute('aria-label'))!.match(/^テロップ「(.*)」 ([\d.]+)秒から([\d.]+)秒間$/s)!;
  const telop = { text, startTime: Number(start), duration: Number(length) };

  // Reach it with Tab and select it with Enter
  await item.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(item).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'テロップ' })).toHaveAttribute('aria-selected', 'true');

  const saved = async () => (await savedProject(page))!.subtitles.find((s) => s.text.ja === telop.text)!;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.001;

  // Three steps later, then one back
  for (const key of ['Alt+ArrowRight', 'Alt+ArrowRight', 'Alt+ArrowRight', 'Alt+ArrowLeft']) await page.keyboard.press(key);
  await expectSaved(
    page,
    (p) => close(p.subtitles.find((s) => s.text.ja === telop.text)!.startTime, telop.startTime + 0.2),
    'テロップが 0.2 秒後ろへ動く'
  );
  expect((await saved()).duration, '長さは変わらない').toBe(telop.duration);

  // Longer by two steps, shorter by one (after a pause: edits in quick succession undo as one step)
  await page.waitForTimeout(1200);
  for (const key of ['Alt+Shift+ArrowRight', 'Alt+Shift+ArrowRight', 'Alt+Shift+ArrowLeft']) await page.keyboard.press(key);
  await expectSaved(
    page,
    (p) => close(p.subtitles.find((s) => s.text.ja === telop.text)!.duration, telop.duration + 0.1),
    'テロップが 0.1 秒長くなる'
  );
  expect(close((await saved()).startTime, telop.startTime + 0.2), '位置は変わらない').toBe(true);
  await expect(item).toHaveAttribute('aria-label', new RegExp(`${(telop.startTime + 0.2).toFixed(1)}秒から${(telop.duration + 0.1).toFixed(1)}秒間`));

  // Keys pressed in one go are one step for undo: the three presses that changed the length
  await page.keyboard.press('Control+z');
  await expectSaved(
    page,
    (p) => {
      const now = p.subtitles.find((s) => s.text.ja === telop.text)!;
      return close(now.duration, telop.duration) && close(now.startTime, telop.startTime + 0.2);
    },
    '元に戻すと長さだけが元に戻る'
  );

  // With nothing selected the keys say what to do instead of doing nothing
  await page.reload();
  await expect(timeline(page)).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText('動かすアイテム（クリップ、テロップ、音声）をタイムライン上で選択してください。')).toBeVisible();
});

test('動きを減らす設定のパソコンでは、アニメーションが止まる', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button')].slice(0, 40).map((el) => parseFloat(getComputedStyle(el).transitionDuration) || 0)
  );
  expect(Math.max(...durations), '切り替えの効果は一瞬で終わる').toBeLessThan(0.001);
});
