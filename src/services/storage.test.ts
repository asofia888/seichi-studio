import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeProject } from '../test/makeProject';
import { VideoClipItem } from '../types';

type Storage = typeof import('./storage');
let storage: Storage;

const DAY = 24 * 60 * 60 * 1000;

// Every test gets an empty database, and a fresh module so no connection is reused
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  storage = await import('./storage');
});

const file = (name: string, lastModified = 1) => new File([`contents of ${name}`], name, { lastModified });

const projectUsing = (...blobKeys: string[]) =>
  makeProject({
    videoClips: blobKeys.map(
      (blobKey, i): VideoClipItem => ({
        id: `clip${i}`,
        name: blobKey,
        type: 'video',
        blobKey,
        startTime: i * 5,
        duration: 5,
        trimStart: 0,
        trimEnd: 5,
      })
    ),
  });

const isStored = async (key: string) => (await storage.getMediaBlob(key)) !== null;

describe('saveMediaFile', () => {
  it('stores the same file only once', async () => {
    const first = await storage.saveMediaFile(file('参道.mp4'));
    const second = await storage.saveMediaFile(file('参道.mp4'));
    expect(second).toBe(first);
    expect(await (await storage.getMediaBlob(first))!.text()).toBe('contents of 参道.mp4');
  });

  it('stores a different file (or a newer version of it) separately', async () => {
    const a = await storage.saveMediaFile(file('参道.mp4', 1));
    const b = await storage.saveMediaFile(file('参道.mp4', 2));
    const c = await storage.saveMediaFile(file('拝殿.mp4', 1));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('cleanUpUnusedMedia', () => {
  it('deletes a file the project no longer uses only after the grace period', async () => {
    const used = await storage.saveMediaFile(file('used.mp4'));
    const unused = await storage.saveMediaFile(file('unused.mp4'));
    const project = projectUsing(used);

    expect(await storage.cleanUpUnusedMedia(project, 0)).toBe(0);
    expect(await storage.cleanUpUnusedMedia(project, 13 * DAY)).toBe(0);
    expect(await isStored(unused)).toBe(true);

    expect(await storage.cleanUpUnusedMedia(project, 14 * DAY)).toBe(1);
    expect(await isStored(unused)).toBe(false);
    expect(await isStored(used)).toBe(true);
  });

  it('restarts the grace period when a file is used again in between', async () => {
    const key = await storage.saveMediaFile(file('a.mp4'));
    await storage.cleanUpUnusedMedia(projectUsing(), 0);
    await storage.cleanUpUnusedMedia(projectUsing(key), 10 * DAY); // e.g. an old project file was loaded
    await storage.cleanUpUnusedMedia(projectUsing(), 11 * DAY);

    expect(await storage.cleanUpUnusedMedia(projectUsing(), 20 * DAY)).toBe(0);
    expect(await storage.cleanUpUnusedMedia(projectUsing(), 25 * DAY)).toBe(1);
  });

  it('keeps a file shared by several clips while any of them uses it', async () => {
    const key = await storage.saveMediaFile(file('a.mp4'));
    await storage.cleanUpUnusedMedia(projectUsing(key, key), 0);
    expect(await storage.cleanUpUnusedMedia(projectUsing(key), 30 * DAY)).toBe(0);
    expect(await isStored(key)).toBe(true);
  });

  it('leaves the saved project untouched', async () => {
    const key = await storage.saveMediaFile(file('a.mp4'));
    await storage.saveProjectToStorage(projectUsing(key));
    await storage.cleanUpUnusedMedia(projectUsing(key), 0);

    const loaded = await storage.loadLastProject();
    expect(loaded?.videoClips[0].blobKey).toBe(key);
    expect(loaded?.videoClips[0].dataUrl).toMatch(/^blob:/); // reconnected to the stored file
  });
});
