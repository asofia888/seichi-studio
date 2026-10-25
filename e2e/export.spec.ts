/**
 * Video export: the file is played back in the browser and checked picture by picture and by its sound
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { makePng, makeWav, MIC_TONE_HZ } from './media';
import { makeVideos } from './videos';
import {
  addPhotos,
  expect,
  expectSaved,
  openApp,
  openTab,
  pressShortcut,
  savedProject,
  seek,
  startEmptyProject,
  test,
  timeline,
} from './app';

// Encoding a 1080p video takes a while in a test browser without a graphics card
test.describe.configure({ timeout: 240_000 });

const RED: [number, number, number] = [200, 30, 30];
const BLUE: [number, number, number] = [30, 60, 200];
const GREEN: [number, number, number] = [40, 180, 60];
const BGM_HZ = 440;
const GRID_W = 32;
const GRID_H = 18;

interface Frame {
  /** GRID_W x GRID_H colours, row by row */
  pixels: number[][];
}

/** Export with the dialog and return the downloaded file; `choices` are the option buttons to press first */
async function exportVideo(page: Page, ...choices: RegExp[]) {
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  for (const choice of choices) await page.getByRole('button', { name: choice }).click();
  const downloading = page.waitForEvent('download', { timeout: 200_000 });
  await page.getByRole('button', { name: /動画書き出しを開始/ }).click();
  const download = await downloading;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** Play the file in the page and take small pictures of it at `times` */
async function framesAt(page: Page, bytes: Buffer, mimeType: string, times: number[]) {
  return page.evaluate(
    async ({ base64, mimeType, times, w, h }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(new Blob([data], { type: mimeType }));
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error(`このブラウザで再生できません: ${video.error?.message}`));
      });
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const frames: { pixels: number[][] }[] = [];
      for (const t of times) {
        await new Promise((resolve) => {
          video.onseeked = resolve;
          video.currentTime = t;
        });
        ctx.drawImage(video, 0, 0, w, h);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const pixels: number[][] = [];
        for (let i = 0; i < w * h; i++) pixels.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
        frames.push({ pixels });
      }
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, frames };
    },
    { base64: bytes.toString('base64'), mimeType, times, w: GRID_W, h: GRID_H }
  );
}

/** How strongly each tone is heard in each time window, from the decoded soundtrack */
async function toneLevels(page: Page, bytes: Buffer, freqs: number[], windows: [number, number][]) {
  return page.evaluate(
    async ({ base64, freqs, windows }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data.buffer);
      const samples = audio.getChannelData(0);
      // Goertzel: the amplitude of one frequency over a window
      const level = (freq: number, [start, end]: [number, number]) => {
        const from = Math.floor(start * audio.sampleRate);
        const to = Math.min(samples.length, Math.floor(end * audio.sampleRate));
        const coeff = 2 * Math.cos((2 * Math.PI * freq) / audio.sampleRate);
        let s1 = 0;
        let s2 = 0;
        for (let i = from; i < to; i++) {
          const s0 = samples[i] + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / (to - from);
      };
      let peak = 0;
      for (let c = 0; c < audio.numberOfChannels; c++) {
        for (const v of audio.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      }
      return {
        duration: audio.duration,
        levels: freqs.map((f) => windows.map((w) => level(f, w))),
        peak,
      };
    },
    { base64: bytes.toString('base64'), freqs, windows }
  );
}

/** Frame rate and picture size of a video file, read from the file itself */
async function videoStats(bytes: Buffer) {
  const input = new Input({ source: new BlobSource(new Blob([new Uint8Array(bytes)])), formats: ALL_FORMATS });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const stats = await track.computePacketStats();
    return { fps: stats.averagePacketRate, width: track.displayWidth, height: track.displayHeight };
  } finally {
    input.dispose();
  }
}

const average = (pixels: number[][]) =>
  [0, 1, 2].map((c) => pixels.reduce((sum, p) => sum + p[c], 0) / pixels.length);
const center = (frame: Frame) => average(frame.pixels.filter((_, i) => Math.abs((i % GRID_W) - GRID_W / 2) <= 2 && Math.abs(Math.floor(i / GRID_W) - GRID_H / 2) <= 2));
/** Mean colour difference between two pictures over rows [fromRow, toRow) */
const difference = (a: Frame, b: Frame, fromRow: number, toRow: number) => {
  const rows = (f: Frame) => f.pixels.slice(fromRow * GRID_W, toRow * GRID_W);
  const pa = rows(a);
  const pb = rows(b);
  return pa.reduce((sum, p, i) => sum + Math.abs(p[0] - pb[i][0]) + Math.abs(p[1] - pb[i][1]) + Math.abs(p[2] - pb[i][2]), 0) / pa.length;
};
const isRed = ([r, g, b]: number[]) => r > 120 && g < 90 && b < 90;
const isBlue = ([r, g, b]: number[]) => b > 120 && r < 90;
const isDark = (rgb: number[]) => rgb.every((v) => v < 30);
const isGreen = ([r, g, b]: number[]) => g > 120 && r < 90 && b < 110;
const expectColor = (rgb: number[], matches: (rgb: number[]) => boolean, message: string) =>
  expect(matches(rgb), `${message}（実際の色: ${rgb.map(Math.round).join(', ')}）`).toBe(true);

test('写真とテロップを書き出すと、MP4 の映像に正しい順番・時刻で入る（音声なし）', async ({ page }) => {
  await startEmptyProject(page, '書き出しテスト');
  // The first clip starts at 3 s (nothing before it): red 3-11 s, blue 11-19 s
  await addPhotos(page, [
    { name: '朱の鳥居.png', png: makePng(RED) },
    { name: '青い空.png', png: makePng(BLUE) },
  ]);
  await seek(page, 4);
  await openTab(page, 'テロップ');
  await page.getByRole('button', { name: /② 解説テロップ/ }).click(); // 4 s to 10 s

  const file = await exportVideo(page);
  await expect(page.getByText('書き出しが完了しました（MP4 (H.264)）')).toBeVisible();
  expect(file.name).toBe('書き出しテスト_JA_16x9.mp4');

  const video = await framesAt(page, file.bytes, 'video/mp4', [1.5, 6, 10.5, 15]);
  expect(video.width).toBe(1920);
  expect(video.height).toBe(1080);
  expect(video.duration).toBeCloseTo(19, 0);

  const [gap, withTelop, red, blue] = video.frames;
  expectColor(average(gap.pixels), isDark, '写真のない1.5秒は、文字も絵もない黒い画面');
  expectColor(center(red), isRed, '10.5秒は赤い写真');
  expectColor(center(blue), isBlue, '15秒は青い写真');
  expectColor(center(withTelop), isRed, 'テロップがあっても写真は見える');
  // The telop is burned in as a band at the bottom of the picture, and nothing else changes
  const rowDifference = Array.from({ length: GRID_H }, (_, row) => difference(withTelop, red, row, row + 1));
  const telopRows = rowDifference.flatMap((d, row) => (d > 20 ? [row] : []));
  expect(telopRows.length, 'テロップが描かれている').toBeGreaterThan(0);
  expect(Math.min(...telopRows), 'テロップは画面の下部にある').toBeGreaterThanOrEqual(Math.floor(GRID_H * 0.7));
  const otherRows = rowDifference.filter((_, row) => !telopRows.includes(row));
  expect(Math.max(...otherRows), 'テロップ以外は写真のまま').toBeLessThan(5);
});

test('ディゾルブ・色補正・Bロールが、書き出した映像に入る', async ({ page }) => {
  await startEmptyProject(page, 'つなぎテスト');
  await addPhotos(page, [
    { name: '朱の鳥居.png', png: makePng(RED) },
    { name: '青い空.png', png: makePng(BLUE) },
  ]); // red 3-11 s, blue 11-19 s

  // Red at half brightness
  await timeline(page).getByTitle('朱の鳥居', { exact: true }).click();
  await page.getByLabel('明るさ').fill('-50');
  // A 2 s dissolve from red into blue, centred on the cut at 11 s
  await timeline(page).getByTitle('青い空', { exact: true }).click();
  await page.getByRole('button', { name: 'ディゾルブ', exact: true }).click();
  await page.getByLabel('長さ', { exact: true }).fill('2');
  // Green B-roll from 15 s, dissolving in over 0.5 s
  await seek(page, 15);
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Bロールとして再生位置に重ねる/ }).click();
  await (await choosing).setFiles({ name: '苔.png', mimeType: 'image/png', buffer: makePng(GREEN) });
  await expect(timeline(page).getByTitle('苔', { exact: true })).toBeVisible();

  const file = await exportVideo(page);
  const video = await framesAt(page, file.bytes, 'video/mp4', [6, 11, 13, 17.5]);
  expect(video.duration).toBeCloseTo(19, 0);
  const [darkRed, mixed, blue, green] = video.frames.map(center);

  expect(darkRed[0], '明るさを下げた赤（元は200）').toBeGreaterThan(70);
  expect(darkRed[0], '明るさを下げた赤（元は200）').toBeLessThan(130);
  expect(mixed[0], '切り替わりの瞬間は赤と青が半分ずつ').toBeGreaterThan(40);
  expect(mixed[2], '切り替わりの瞬間は赤と青が半分ずつ').toBeGreaterThan(80);
  expect(mixed[2], '切り替わりの瞬間は赤と青が半分ずつ').toBeLessThan(160);
  expectColor(blue, isBlue, '13秒は青い写真');
  expectColor(green, isGreen, '17.5秒は上に重ねた緑の Bロール');
});

test('BGM とナレーションを書き出すと、話している間だけ BGM が下がる（WebM）', async ({ page }) => {
  await startEmptyProject(page, '音声テスト');
  // 3-11 s and 11-19 s: the BGM fades out from 17 s, well after the narration
  await addPhotos(page, [
    { name: '朱の鳥居.png', png: makePng(RED) },
    { name: '青い空.png', png: makePng(BLUE) },
  ]);

  await openTab(page, '音声');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /手持ちのBGM音源/ }).click();
  await (await choosing).setFiles({ name: '雅楽.wav', mimeType: 'audio/wav', buffer: makeWav(BGM_HZ, 12, 0.5) });
  await expect(timeline(page).getByTitle('雅楽', { exact: true })).toBeVisible();

  // Narration from 5 s, recorded with the test browser's microphone (a steady tone)
  await seek(page, 5);
  await pressShortcut(page, 'r');
  await expect(page.getByText('ナレーション録音中...')).toBeVisible();
  await page.waitForTimeout(2500);
  await pressShortcut(page, 'r');
  await expect(timeline(page).getByTitle('録音 (5.0s) 🎙️', { exact: true })).toBeVisible();
  // A busy test machine records a little longer than 2.5 s, so measure from where the take really ends
  await expectSaved(page, (p) => p.audioTracks.some((a) => a.isRecorded), '録音が保存される');
  const take = (await savedProject(page))!.audioTracks.find((a) => a.isRecorded)!;
  const speechEnd = take.startTime + take.duration;

  const file = await exportVideo(page);
  // This test browser cannot encode AAC, so a video with sound is written as WebM
  await expect(page.getByText(/書き出しが完了しました（WebM \(VP\d \/ Opus\)）/)).toBeVisible();
  expect(file.name).toBe('音声テスト_JA_16x9.webm');
  // The soundtrack is brought to YouTube's loudness (the default choice)
  await expect(page.getByText(/音量 -1[34]\.\d LUFS/)).toBeVisible();

  const video = await framesAt(page, file.bytes, 'video/webm', [6]);
  expectColor(center(video.frames[0]), isRed, '6秒は赤い写真');

  const before: [number, number] = [2, 3.5]; // after the BGM fade-in
  const during: [number, number] = [5.6, 6.8];
  const after: [number, number] = [speechEnd + 0.6, speechEnd + 1.2]; // the BGM comes back up over 0.35 s
  const sound = await toneLevels(page, file.bytes, [BGM_HZ, MIC_TONE_HZ], [before, during, after]);
  const [bgm, mic] = sound.levels;
  expect(sound.duration).toBeCloseTo(19, 0);

  expect(bgm[0], 'BGM が鳴っている').toBeGreaterThan(0.05);
  expect(bgm[1] / bgm[0], '話している間は BGM が下がる').toBeLessThan(0.5);
  expect(bgm[2] / bgm[0], '話し終わると BGM が戻る').toBeGreaterThan(0.7);
  expect(mic[1], '録音したナレーションが聞こえる').toBeGreaterThan(5 * mic[0]);
});

test('音が重なって大きくなっても、書き出した音声は割れない（音量をそろえない場合も）', async ({ page }) => {
  await startEmptyProject(page, '音割れテスト');
  await addPhotos(page, [{ name: '朱の鳥居.png', png: makePng(RED) }]); // the video is 11 s

  // Two loud tones a beat apart: once a second they peak together at about 0.65 + 0.45 = 1.1, above full scale
  await openTab(page, '音声');
  for (const [button, name, freq] of [
    [/手持ちのBGM音源/, '雅楽', BGM_HZ],
    [/自然音の音源ファイル/, 'せせらぎ', BGM_HZ + 1],
  ] as const) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: button }).click();
    await (await choosing).setFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: makeWav(freq, 12, 1) });
    await expect(timeline(page).getByTitle(name, { exact: true })).toBeVisible();
  }

  const file = await exportVideo(page, /そろえない/);
  await expect(page.getByText(/書き出しが完了しました/)).toBeVisible();
  await expect(page.getByText(/音量 .*・ピーク -1\.[5-9] dBFS/)).toBeVisible();

  const sound = await toneLevels(page, file.bytes, [BGM_HZ], [[3, 8]]);
  expect(sound.peak, '一番大きいところでも 0 dBFS に届かない').toBeLessThan(0.95);
  expect(sound.levels[0][0], '音量は下げすぎない（そろえないので、大きいところだけを抑える）').toBeGreaterThan(0.3);
});

test('動画の音は使う部分だけが正しい時刻に入り、60fps で書き出せる', async ({ page, browser }) => {
  // 12 s of footage with talking (a 140 Hz buzz) from 4 to 7 s
  const [footage] = await makeVideos(browser, [
    { name: '拝殿.mp4', seconds: 12, color: '#1565c0', speech: [4, 7], recordedAt: '2026-10-01T00:40:00Z' },
  ]);
  await startEmptyProject(page, '動画音声テスト');
  await openTab(page, '素材');
  await page.locator('input[type=file][accept="video/*,image/*"]').setInputFiles(footage);
  const clip = timeline(page).getByTitle('拝殿', { exact: true });
  await expect(clip).toBeVisible(); // 3-15 s

  // Cut off the first 5 s of footage: split at 8 s and delete the first piece, so the rest moves up to 3 s
  await clip.click();
  await seek(page, 8);
  await pressShortcut(page, 's');
  await clip.click();
  await pressShortcut(page, 'Delete');
  await expectSaved(
    page,
    (p) => p.videoClips.length === 1 && p.videoClips[0].startTime === 3 && Math.abs(p.videoClips[0].trimStart - 5) < 0.01,
    '残りの部分（素材の5秒目から）が3秒目に詰まる'
  );

  const file = await exportVideo(page, /^60/);
  await expect(page.getByText(/書き出しが完了しました/)).toBeVisible();
  const stats = await videoStats(file.bytes);
  expect(stats.fps).toBeCloseTo(60, 0);

  // The talking left (footage 5-7 s) is heard at 3-5 s of the video, and nothing after it
  const sound = await toneLevels(page, file.bytes, [140], [[3.3, 4.7], [6, 9]]);
  expect(sound.duration).toBeCloseTo(10, 0);
  const [talking, quiet] = sound.levels[0];
  expect(talking, '話している部分が、詰めた後の時刻で聞こえる').toBeGreaterThan(10 * quiet);
});

test('4K（3840×2160）で書き出せる', async ({ page }) => {
  await startEmptyProject(page, '4Kテスト');
  await addPhotos(page, [{ name: '朱の鳥居.png', png: makePng(RED, 1280, 720) }]);
  // Keep it short: 4K takes a while to encode in a test browser
  await timeline(page).getByTitle('朱の鳥居', { exact: true }).click();
  await page.locator('label', { hasText: '表示尺' }).locator('xpath=following-sibling::input[1]').fill('2');
  await expectSaved(page, (p) => p.duration === 5, '写真は3〜5秒');

  const file = await exportVideo(page, /^2160p/);
  expect(file.name).toMatch(/^4Kテスト_JA_16x9_4K\.(mp4|webm)$/);
  const stats = await videoStats(file.bytes);
  expect([stats.width, stats.height]).toEqual([3840, 2160]);
  const video = await framesAt(page, file.bytes, file.name.endsWith('mp4') ? 'video/mp4' : 'video/webm', [4]);
  expectColor(center(video.frames[0]), isRed, '4K でも写真がそのまま入る');
});

test('書き出しは途中で中止でき、ファイルは作られない', async ({ page }) => {
  await openApp(page);
  let downloads = 0;
  page.on('download', () => downloads++);

  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  await page.getByRole('button', { name: /動画書き出しを開始/ }).click();
  await expect(page.getByText(/映像をエンコード中/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '中止' }).click();

  await expect(page.getByRole('button', { name: /動画書き出しを開始/ })).toBeEnabled();
  await expect(page.getByText('書き出しが完了しました')).toHaveCount(0);
  await expect(page.getByText('書き出し中にエラーが発生しました')).toHaveCount(0);
  expect(downloads).toBe(0);
});
