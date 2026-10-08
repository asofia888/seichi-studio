/**
 * Shared steps for the browser tests: open the app, read what it saved, add files, use the timeline
 */
import { expect, test as base, type Page } from '@playwright/test';
import type { ProjectData } from '../src/types';
import { makeProject } from '../src/test/makeProject';

// Every test fails if the page throws an uncaught error along the way
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors, 'ページでエラーが起きないこと').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const titleInput = (page: Page) => page.getByTitle('プロジェクト名をクリックして変更');
export const timeline = (page: Page) => page.getByRole('region', { name: 'タイムライン' });
export const undoButton = (page: Page) => page.getByRole('button', { name: '元に戻す' });
export const redoButton = (page: Page) => page.getByRole('button', { name: 'やり直す' });

/** Open the app and wait until the saved project (if any) has been restored */
export async function openApp(page: Page, expectedTitle?: string | RegExp) {
  await page.goto('/');
  await expect(titleInput(page)).toHaveValue(expectedTitle ?? /.+/);
}

/** The project as the app last saved it in the browser (null before the first save) */
export async function savedProject(page: Page): Promise<ProjectData | null> {
  return page.evaluate(
    () =>
      new Promise<ProjectData | null>((resolve, reject) => {
        const request = indexedDB.open('SacredVideoStudioDB', 1);
        // The app has not created its database yet: do not create an empty one in its place
        request.onupgradeneeded = () => request.transaction!.abort();
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction('projects', 'readonly').objectStore('projects').get('last_project');
          get.onsuccess = () => {
            db.close();
            resolve(get.result ?? null);
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
}

/** Wait until the saved project satisfies `check` (saving happens shortly after each edit) */
export async function expectSaved(page: Page, check: (project: ProjectData) => boolean, message: string) {
  await expect.poll(async () => {
    const project = await savedProject(page);
    return project !== null && check(project);
  }, { message }).toBe(true);
}

/** Load a project file with the header's 読込 button */
export async function loadProjectFile(page: Page, project: ProjectData) {
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: `${project.title}.sacred.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(titleInput(page)).toHaveValue(project.title);
}

/** A project with no opening/ending cards and nothing on the timeline, loaded from a file */
export async function startEmptyProject(page: Page, title = 'E2E テスト') {
  await openApp(page);
  const project = makeProject({ title, duration: 0 });
  project.branding.opDuration = 0;
  project.branding.edDuration = 0;
  await loadProjectFile(page, project);
}

// The sidebar tabs, by the hint shown on each
const TABS = {
  素材: '映像・写真',
  テロップ: '定型テロップ',
  翻訳: '多言語字幕 & 用語集 (Claude API)',
  地図: 'アクセス地図案内',
  音声: 'ナレーション・音声',
  目次: 'チャプター & YouTube概要欄',
};

export async function openTab(page: Page, tab: keyof typeof TABS) {
  await page.getByTitle(TABS[tab], { exact: true }).click();
}

/** Add photos with the 素材 tab; each one is placed after the last clip and shows for 8 s */
export async function addPhotos(page: Page, photos: { name: string; png: Buffer }[]) {
  await openTab(page, '素材');
  for (const photo of photos) {
    await page.locator('input[type=file][accept="video/*,image/*"]').setInputFiles({
      name: photo.name,
      mimeType: 'image/png',
      buffer: photo.png,
    });
    await expect(timeline(page).getByTitle(photo.name.replace(/\.[^.]+$/, ''), { exact: true })).toBeVisible();
  }
}

/** Shortcut keys go to the page, not to a button or field that happens to have focus */
export async function pressShortcut(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
}

/** Move the playhead to `seconds` (whole seconds) with the keyboard */
export async function seek(page: Page, seconds: number) {
  await pressShortcut(page, 'Home');
  for (let i = 0; i < seconds; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(playheadTime(page)).toHaveText(`00:${String(seconds).padStart(2, '0')}.0`);
}

/** The time shown under the preview, e.g. 00:05.0 */
export const playheadTime = (page: Page) => page.getByText(/^\d{2}:\d{2}\.\d$/).first();
