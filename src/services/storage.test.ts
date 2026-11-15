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
    await storage.saveProjectToStorage(projectUsing(key), 'slot');
    await storage.setCurrentProjectSlot('slot');
    await storage.cleanUpUnusedMedia(projectUsing(key), 0);

    const { project: loaded } = await storage.loadCurrentProject();
    expect(loaded?.videoClips[0].blobKey).toBe(key);
    expect(loaded?.videoClips[0].dataUrl).toMatch(/^blob:/); // reconnected to the stored file
  });

  it('keeps the files of every stored project, not only the one being opened', async () => {
    const mine = await storage.saveMediaFile(file('mine.mp4'));
    const others = await storage.saveMediaFile(file('others.mp4'));
    const nobodys = await storage.saveMediaFile(file('nobodys.mp4'));
    await storage.saveProjectToStorage(projectUsing(others), 'another project');

    await storage.cleanUpUnusedMedia(projectUsing(mine), 0);
    expect(await storage.cleanUpUnusedMedia(projectUsing(mine), 30 * DAY)).toBe(1);
    expect(await isStored(mine)).toBe(true);
    expect(await isStored(others)).toBe(true);
    expect(await isStored(nobodys)).toBe(false);
  });

  it('lets go of a deleted project\'s files after the grace period', async () => {
    const key = await storage.saveMediaFile(file('a.mp4'));
    await storage.saveProjectToStorage(projectUsing(key), 'old project');
    await storage.cleanUpUnusedMedia(projectUsing(), 0);

    await storage.deleteStoredProject('old project');
    expect(await storage.cleanUpUnusedMedia(projectUsing(), 1 * DAY)).toBe(0);
    expect(await storage.cleanUpUnusedMedia(projectUsing(), 20 * DAY)).toBe(1);
  });
});

/** Put a value straight into the projects store, as an earlier version of the app did */
const putRaw = (key: string, value: unknown) =>
  new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('SacredVideoStudioDB', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('media_blobs');
      open.result.createObjectStore('projects');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(value, key);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });

describe('projects kept side by side', () => {
  it('starts with an empty slot on the first visit, and keeps using it', async () => {
    const first = await storage.loadCurrentProject();
    expect(first.project).toBeNull();

    await storage.saveProjectToStorage(makeProject({ title: '初めての動画' }), first.slotId);
    const again = await storage.loadCurrentProject();
    expect(again.slotId).toBe(first.slotId);
    expect(again.project?.title).toBe('初めての動画');
  });

  it('takes over the single project an earlier version saved', async () => {
    await putRaw('last_project', makeProject({ title: '以前の版で作った動画' }));

    const { slotId, project } = await storage.loadCurrentProject();
    expect(project?.title).toBe('以前の版で作った動画');
    expect((await storage.listStoredProjects()).map((p) => p.slotId)).toEqual([slotId]);
    // ...once: it is not picked up again as a second project
    expect((await storage.loadCurrentProject()).slotId).toBe(slotId);
    expect(await storage.listStoredProjects()).toHaveLength(1);
  });

  it('lists every project, the most recently edited first', async () => {
    await storage.saveProjectToStorage(makeProject({ title: '古い', updatedAt: '2026-01-01T00:00:00.000Z' }), 'a');
    await storage.saveProjectToStorage(makeProject({ title: '新しい', updatedAt: '2026-03-01T00:00:00.000Z' }), 'b');

    const list = await storage.listStoredProjects();
    expect(list.map((p) => p.title)).toEqual(['新しい', '古い']);
    expect(list[0]).toMatchObject({ slotId: 'b', aspectRatio: '16:9', clipCount: 0, isReadable: true });
  });

  it('opens another project and starts with it the next time', async () => {
    await storage.saveProjectToStorage(makeProject({ title: 'A' }), 'a');
    await storage.saveProjectToStorage(makeProject({ title: 'B' }), 'b');
    await storage.setCurrentProjectSlot('a');

    expect((await storage.openStoredProject('b'))?.title).toBe('B');
    expect(await storage.loadCurrentProject()).toMatchObject({ slotId: 'b', project: { title: 'B' } });
    expect(await storage.openStoredProject('no such slot')).toBeNull();
    expect((await storage.loadCurrentProject()).slotId).toBe('b');
  });

  it('copies a project into a slot of its own, sharing its media', async () => {
    const key = await storage.saveMediaFile(file('a.mp4'));
    await storage.saveProjectToStorage({ ...projectUsing(key), title: '横の動画' }, 'a');

    const copySlot = await storage.duplicateStoredProject('a');
    const copy = await storage.readStoredProject(copySlot!);
    expect(copy?.title).toBe('横の動画 のコピー');
    expect(copy?.videoClips[0].blobKey).toBe(key);
    expect(await storage.listStoredProjects()).toHaveLength(2);
  });

  it('deletes only the project asked for', async () => {
    await storage.saveProjectToStorage(makeProject({ title: 'A' }), 'a');
    await storage.saveProjectToStorage(makeProject({ title: 'B' }), 'b');
    await storage.deleteStoredProject('a');
    expect((await storage.listStoredProjects()).map((p) => p.title)).toEqual(['B']);
  });

  it('repairs a stored project with parts missing, and shows an unusable one as such', async () => {
    await putRaw('project:partial', { title: '途中まで', videoClips: [] });
    await putRaw('project:garbage', 'not a project');

    expect((await storage.readStoredProject('partial'))?.subtitles).toEqual([]);
    expect(await storage.readStoredProject('garbage')).toBeNull();
    const list = await storage.listStoredProjects();
    expect(list.find((p) => p.slotId === 'partial')?.isReadable).toBe(true);
    expect(list.find((p) => p.slotId === 'garbage')?.isReadable).toBe(false);
  });
});
