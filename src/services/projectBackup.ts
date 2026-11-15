/**
 * Project backups: one ZIP file holding a project together with its photos, videos and sound,
 * so the work can be kept outside the browser and moved to another PC or browser.
 *
 *   backup.json          the project, and which file in the archive is which media file
 *   media/001_name.mp4   the media files, as they were added
 */
import { ProjectData } from '../types';
import { InvalidProjectError, normalizeProject } from './projectSchema';
import {
  getMediaBlob,
  hasMediaBlob,
  newProjectSlot,
  safeFileName,
  saveMediaBlob,
  saveProjectToStorage,
} from './storage';
import { buildZip, readZip, ZipFormatError, ZipInput } from './zip';

const BACKUP_FORMAT = 'seichi-studio-backup';
const BACKUP_VERSION = 1;
const MANIFEST_NAME = 'backup.json';

interface BackupMedia {
  /** The key the project's clips and tracks refer to (their blobKey) */
  key: string;
  /** Path of the file inside the archive */
  file: string;
  /** MIME type */
  type: string;
  size: number;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  project: ProjectData;
  media: BackupMedia[];
}

export interface BackupProgress {
  percentage: number;
  statusText: string;
}

export class BackupError extends Error {}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** A readable name for a media file inside the archive (the number in front is what identifies it) */
function archiveName(index: number, key: string, itemName: string, type: string): string {
  // Files added by the user are stored under "file_<size>_<modified>_<original name>"
  const original = key.startsWith('file_') ? key.split('_').slice(3).join('_') : '';
  const extension = EXTENSION_BY_TYPE[type.split(';')[0]];
  const name = original || (extension ? `${itemName}.${extension}` : itemName);
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what must not end up in a file name
  const safe = name.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '_').slice(0, 80) || 'media';
  return `media/${String(index + 1).padStart(3, '0')}_${safe}`;
}

export interface CreatedBackup {
  blob: Blob;
  fileName: string;
  /** Names of the clips and tracks whose media could not be found (they are in the backup without it) */
  missing: string[];
}

/**
 * Pack `project` and its media into one ZIP file. Media is taken from this browser's storage;
 * a file that was never stored (saving it failed) is taken from the page while it is still open.
 */
export async function createBackup(
  project: ProjectData,
  onProgress?: (p: BackupProgress) => void,
  signal?: AbortSignal
): Promise<CreatedBackup> {
  onProgress?.({ percentage: 0, statusText: '素材を集めています...' });
  const media: BackupMedia[] = [];
  const files: ZipInput[] = [];
  const missing: string[] = [];
  const keyOfItem = new Map<string, string | undefined>();
  const packed = new Set<string>();

  for (const item of [...project.videoClips, ...project.audioTracks]) {
    signal?.throwIfAborted();
    const isSessionOnly = !item.blobKey && !!item.dataUrl?.startsWith('blob:');
    if (!item.blobKey && !isSessionOnly) continue; // no media, or media kept inside the project itself (data:)
    const key = item.blobKey ?? `backup_${item.id}`;
    if (packed.has(key)) {
      keyOfItem.set(item.id, key);
      continue;
    }

    let blob = item.blobKey ? await getMediaBlob(item.blobKey).catch(() => null) : null;
    if (!blob && item.dataUrl?.startsWith('blob:')) {
      blob = await fetch(item.dataUrl).then((r) => r.blob()).catch(() => null);
    }
    if (!blob) {
      missing.push(item.name);
      continue;
    }
    packed.add(key);
    keyOfItem.set(item.id, key);
    const file = archiveName(media.length, key, item.name, blob.type);
    media.push({ key, file, type: blob.type, size: blob.size });
    files.push({ name: file, data: blob });
  }

  // blob: URLs mean nothing outside this page; the keys are what reconnects the media
  const portable = <T extends { id: string; dataUrl?: string; blobKey?: string }>(item: T): T => {
    const { dataUrl, blobKey: _blobKey, ...rest } = item;
    const key = keyOfItem.get(item.id);
    return {
      ...rest,
      ...(dataUrl && !dataUrl.startsWith('blob:') ? { dataUrl } : {}),
      ...(key ? { blobKey: key } : {}),
    } as unknown as T;
  };
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      ...project,
      videoClips: project.videoClips.map(portable),
      audioTracks: project.audioTracks.map(portable),
    },
    media,
  };
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });

  const blob = await buildZip([{ name: MANIFEST_NAME, data: manifestBlob }, ...files], {
    signal,
    onProgress: (done, total) =>
      onProgress?.({
        percentage: total > 0 ? Math.floor((done / total) * 100) : 100,
        statusText: `素材をまとめています (${files.length} 個)...`,
      }),
  });
  onProgress?.({ percentage: 100, statusText: '完成しました' });
  return { blob, fileName: `${safeFileName(project.title, 'sacred_project')}.sacred.zip`, missing };
}

export interface RestoredBackup {
  /** Where the project was stored; open it with openStoredProject */
  slotId: string;
  title: string;
  /** Media files named in the backup that could not be restored */
  missing: string[];
}

/**
 * Unpack a backup into this browser as a new project (nothing already stored is replaced):
 * its media goes into the media store, and the project into a slot of its own.
 */
export async function restoreBackup(
  archive: Blob,
  onProgress?: (p: BackupProgress) => void,
  signal?: AbortSignal
): Promise<RestoredBackup> {
  onProgress?.({ percentage: 0, statusText: 'バックアップを開いています...' });
  const notABackup = () => new BackupError('このファイルは、このアプリのバックアップ（.sacred.zip）ではありません。');

  const entries = await readZip(archive).catch((e) => {
    throw e instanceof ZipFormatError ? notABackup() : e;
  });
  const manifestEntry = entries.find((e) => e.name === MANIFEST_NAME);
  if (!manifestEntry) throw notABackup();

  let manifest: Partial<BackupManifest>;
  let project: ProjectData;
  try {
    manifest = JSON.parse(await (await manifestEntry.blob()).text());
    if (manifest?.format !== BACKUP_FORMAT) throw notABackup();
    project = normalizeProject(manifest.project);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof InvalidProjectError) throw notABackup();
    throw e;
  }
  if (typeof manifest.version === 'number' && manifest.version > BACKUP_VERSION) {
    throw new BackupError('このバックアップは新しいバージョンのアプリで作られています。アプリを更新してからお試しください。');
  }

  const listed = (Array.isArray(manifest.media) ? manifest.media : []).filter(
    (m): m is BackupMedia => typeof m?.key === 'string' && typeof m?.file === 'string'
  );
  const totalBytes = listed.reduce((sum, m) => sum + (Number(m.size) || 0), 0);
  let doneBytes = 0;
  const missing: string[] = [];

  for (const item of listed) {
    signal?.throwIfAborted();
    onProgress?.({
      percentage: totalBytes > 0 ? Math.floor((doneBytes / totalBytes) * 100) : 0,
      statusText: `素材を取り込んでいます (${listed.indexOf(item) + 1} / ${listed.length})...`,
    });
    // Another program may have rewritten the names; the number in front still identifies the file
    const numbered = item.file.match(/^media\/\d+/)?.[0];
    const entry =
      entries.find((e) => e.name === item.file) ??
      (numbered ? entries.find((e) => e.name.startsWith(`${numbered}_`) || e.name === numbered) : undefined);
    try {
      if (!entry) throw new Error('not in the archive');
      // The same file may already be here (e.g. the backup is restored a second time)
      if (!(await hasMediaBlob(item.key))) {
        await saveMediaBlob(item.key, await entry.blob(typeof item.type === 'string' ? item.type : undefined));
      }
    } catch (e) {
      console.warn(`Could not restore ${item.file}:`, e);
      missing.push(item.file.replace(/^media\/\d+_?/, '') || item.file);
    }
    doneBytes += Number(item.size) || 0;
  }

  signal?.throwIfAborted();
  const slotId = newProjectSlot();
  await saveProjectToStorage({ ...project, updatedAt: new Date().toISOString() }, slotId);
  onProgress?.({ percentage: 100, statusText: '読み込みました' });
  return { slotId, title: project.title, missing };
}

/** Hand a file to the browser's downloads */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download has started by then; a large file is read from disk, not from this URL's memory
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
