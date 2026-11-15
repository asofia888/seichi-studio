import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeProject } from '../test/makeProject';
import { AudioTrackItem, ProjectData, VideoClipItem } from '../types';

let storage: typeof import('./storage');
let backup: typeof import('./projectBackup');
let zip: typeof import('./zip');

// Every test gets an empty browser, and fresh modules so no connection is reused
const emptyBrowser = async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  storage = await import('./storage');
  backup = await import('./projectBackup');
  zip = await import('./zip');
};
beforeEach(emptyBrowser);

const clip = (id: string, blobKey?: string, more: Partial<VideoClipItem> = {}): VideoClipItem => ({
  id,
  name: id,
  type: 'video',
  blobKey,
  startTime: 3,
  duration: 5,
  trimStart: 0,
  trimEnd: 5,
  ...more,
});

const narration = (id: string, blobKey: string): AudioTrackItem => ({
  id,
  name: id,
  type: 'narration',
  startTime: 4,
  duration: 2,
  volume: 1,
  blobKey,
  isRecorded: true,
});

/** A project with a video used twice, a recording, and a photo kept inside the project itself */
async function storeProject(): Promise<ProjectData> {
  const video = await storage.saveMediaFile(new File(['the video'], '参道.mp4', { type: 'video/mp4', lastModified: 5 }));
  await storage.saveMediaBlob('narration_1', new Blob(['the voice'], { type: 'audio/webm' }));
  return makeProject({
    title: '戸隠神社 奥社',
    videoClips: [
      clip('first half', video, { dataUrl: 'blob:http://localhost/dead-after-reload' }),
      clip('second half', video, { startTime: 8 }),
      clip('photo', undefined, { type: 'image', startTime: 13, dataUrl: 'data:image/png;base64,AAAA' }),
    ],
    audioTracks: [narration('voice', 'narration_1')],
  });
}

describe('createBackup / restoreBackup', () => {
  it('moves a project and its media to another browser', async () => {
    const project = await storeProject();
    const created = await backup.createBackup(project);
    expect(created.fileName).toBe('戸隠神社 奥社.sacred.zip');
    expect(created.missing).toEqual([]);

    await emptyBrowser(); // the other PC
    const restored = await backup.restoreBackup(created.blob);
    expect(restored).toMatchObject({ title: '戸隠神社 奥社', missing: [] });

    const opened = (await storage.openStoredProject(restored.slotId))!;
    expect(opened.videoClips.map((c) => c.id)).toEqual(['first half', 'second half', 'photo']);
    expect(opened.videoClips[0].dataUrl).toMatch(/^blob:/); // reconnected to the restored file
    expect(opened.videoClips[2].dataUrl).toBe('data:image/png;base64,AAAA');
    const video = (await storage.getMediaBlob(opened.videoClips[0].blobKey!))!;
    expect(await video.text()).toBe('the video');
    expect(video.type).toBe('video/mp4');
    expect(await (await storage.getMediaBlob('narration_1'))!.text()).toBe('the voice');
  });

  it('packs a file used by several clips once, under a name a person can recognise', async () => {
    const created = await backup.createBackup(await storeProject());
    const names = (await zip.readZip(created.blob)).map((e) => e.name);
    expect(names).toEqual(['backup.json', 'media/001_参道.mp4', 'media/002_voice.webm']);
  });

  it('writes nothing that only this page understands, or that must stay private', async () => {
    const project = { ...(await storeProject()), claudeApiKey: undefined };
    const created = await backup.createBackup(project);
    const manifest = await (await (await zip.readZip(created.blob))[0].blob()).text();
    expect(manifest).not.toContain('blob:');
    expect(JSON.parse(manifest).project.videoClips[0].blobKey).toBe(project.videoClips[0].blobKey);
  });

  it('adds a project next to the ones already here, replacing none', async () => {
    const project = await storeProject();
    await storage.saveProjectToStorage(project, 'original');
    const created = await backup.createBackup(project);

    const restored = await backup.restoreBackup(created.blob);
    expect(restored.slotId).not.toBe('original');
    expect(await storage.listStoredProjects()).toHaveLength(2);
  });

  it('says which media could not be found, and still makes the backup', async () => {
    const project = await storeProject();
    project.videoClips.push(clip('lost clip', 'file_1_1_gone.mp4', { startTime: 20 }));
    const created = await backup.createBackup(project);
    expect(created.missing).toEqual(['lost clip']);

    await emptyBrowser();
    const restored = await backup.restoreBackup(created.blob);
    const opened = (await storage.openStoredProject(restored.slotId))!;
    expect(opened.videoClips.map((c) => c.id)).toContain('lost clip');
  });

  it('still finds the media when another program renamed the files in the archive', async () => {
    const created = await backup.createBackup(await storeProject());
    const entries = await zip.readZip(created.blob);
    const renamed = await zip.buildZip(
      await Promise.all(
        entries.map(async (e) => ({ name: e.name.replace('参道', '???'), data: await e.blob() }))
      )
    );

    await emptyBrowser();
    const restored = await backup.restoreBackup(renamed);
    expect(restored.missing).toEqual([]);
    const opened = (await storage.openStoredProject(restored.slotId))!;
    expect(await (await storage.getMediaBlob(opened.videoClips[0].blobKey!))!.text()).toBe('the video');
  });

  it('refuses files that are not a backup of this app', async () => {
    const otherZip = await zip.buildZip([{ name: 'readme.txt', data: new Blob(['hello']) }]);
    const wrongJson = await zip.buildZip([{ name: 'backup.json', data: new Blob(['{"format":"something else"}']) }]);
    for (const file of [new Blob(['not a zip at all']), otherZip, wrongJson]) {
      await expect(backup.restoreBackup(file)).rejects.toThrow(backup.BackupError);
    }
    expect(await storage.listStoredProjects()).toEqual([]);
  });
});
