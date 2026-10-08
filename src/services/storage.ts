/**
 * IndexedDB storage for video/audio/image blobs and project persistence
 */
import { ProjectData } from '../types';

const DB_NAME = 'SacredVideoStudioDB';
const DB_VERSION = 1;
const STORE_BLOBS = 'media_blobs';
const STORE_PROJECTS = 'projects';
const LAST_PROJECT_KEY = 'last_project';
// Kept next to the project: when each stored file was first found unused (ms)
const UNUSED_MEDIA_KEY = 'unused_media_since';
// Earlier versions kept the project in localStorage (5MB limit, failed silently when full)
const LEGACY_LOCALSTORAGE_KEY = 'sacred_studio_last_project';

// Files the project no longer uses are deleted only after this long, so a project file (.json)
// saved in the meantime still finds its media when it is loaded in this browser
export const UNUSED_MEDIA_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// Reuse one connection instead of opening a new one on every save
let dbPromise: Promise<IDBDatabase> | null = null;
let openedDb: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS);
      }
    };
    request.onsuccess = () => {
      openedDb = request.result;
      resolve(request.result);
    };
    request.onerror = () => {
      dbPromise = null; // allow a retry on the next call
      reject(request.error);
    };
  });
  return dbPromise;
}

export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const req = store.put(blob, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const store = tx.objectStore(STORE_BLOBS);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Keep a file the user added in this browser and return its key. The same file added again
 * (same name, size and modification time) reuses the stored copy instead of storing another one.
 */
export async function saveMediaFile(file: File): Promise<string> {
  const key = `file_${file.size}_${file.lastModified}_${file.name}`;
  const db = await openDatabase();
  const isStored = await new Promise<boolean>((resolve, reject) => {
    const req = db.transaction(STORE_BLOBS, 'readonly').objectStore(STORE_BLOBS).count(key);
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
  });
  if (!isStored) await saveMediaBlob(key, file);
  return key;
}

/** The media files a project plays */
export function mediaKeysInUse(project: ProjectData): Set<string> {
  return new Set(
    [...project.videoClips, ...project.audioTracks].flatMap((item) => (item.blobKey ? [item.blobKey] : []))
  );
}

/**
 * Which stored files to delete now: those unused for UNUSED_MEDIA_GRACE_MS. Returns the new
 * record of when each file still kept was first found unused (files in use are not in it).
 */
export function planMediaCleanup(
  storedKeys: string[],
  usedKeys: Set<string>,
  unusedSince: Record<string, number>,
  now: number
): { toDelete: string[]; unusedSince: Record<string, number> } {
  const toDelete: string[] = [];
  const stillUnused: Record<string, number> = {};
  for (const key of storedKeys) {
    if (usedKeys.has(key)) continue;
    const since = unusedSince[key] ?? now;
    if (now - since >= UNUSED_MEDIA_GRACE_MS) {
      toDelete.push(key);
    } else {
      stillUnused[key] = since;
    }
  }
  return { toDelete, unusedSince: stillUnused };
}

/**
 * Delete stored files that `project` (the saved project, read at startup) has not used for
 * UNUSED_MEDIA_GRACE_MS. Run only at startup: during a session, undo can bring back a clip
 * whose file the current project no longer uses. Returns how many files were deleted.
 */
export async function cleanUpUnusedMedia(project: ProjectData, now = Date.now()): Promise<number> {
  const usedKeys = mediaKeysInUse(project);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_BLOBS, STORE_PROJECTS], 'readwrite');
    const blobs = tx.objectStore(STORE_BLOBS);
    const meta = tx.objectStore(STORE_PROJECTS);
    const keysReq = blobs.getAllKeys();
    const sinceReq = meta.get(UNUSED_MEDIA_KEY);
    let deleted = 0;
    // Requests in a transaction finish in order, so the keys are ready here too
    sinceReq.onsuccess = () => {
      const plan = planMediaCleanup(keysReq.result.map(String), usedKeys, sinceReq.result ?? {}, now);
      for (const key of plan.toDelete) blobs.delete(key);
      meta.put(plan.unusedSince, UNUSED_MEDIA_KEY);
      deleted = plan.toDelete.length;
    };
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveProjectToStorage(project: ProjectData): Promise<void> {
  const write = (db: IDBDatabase) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(project, LAST_PROJECT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // Commit now rather than at the end of the task: a page being closed aborts unfinished transactions
      tx.commit?.();
    });
  // Once the database is open, start the write synchronously: a save requested while the page
  // is closing (pagehide) must not wait for a later tick, or it never reaches the database
  await (openedDb ? write(openedDb) : openDatabase().then(write));

  // IndexedDB is now the source of truth; drop the legacy copy so it can never resurface stale
  try {
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
  } catch {}
}

export async function loadLastProject(): Promise<ProjectData | null> {
  let project: ProjectData | null = null;
  try {
    const db = await openDatabase();
    project = await new Promise<ProjectData | null>((resolve, reject) => {
      const req = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).get(LAST_PROJECT_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('Failed reading project from IndexedDB', e);
  }

  if (!project) {
    try {
      const cached = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
      if (cached) {
        project = JSON.parse(cached);
      }
    } catch (e) {
      console.error('Failed reading cached project', e);
    }
  }

  return project ? restoreMediaUrls(project) : null;
}

/**
 * blob: URLs only live as long as the page, so the media URLs inside a saved project are dead
 * after a reload. Recreate them from the files kept in IndexedDB (by blobKey), and clear dead
 * blob: URLs that have no stored file so nothing tries to load them.
 */
export async function restoreMediaUrls(project: ProjectData): Promise<ProjectData> {
  const restore = async <T extends { dataUrl?: string; blobKey?: string }>(item: T): Promise<T> => {
    if (item.blobKey) {
      const blob = await getMediaBlob(item.blobKey).catch(() => null);
      if (blob) {
        return { ...item, dataUrl: URL.createObjectURL(blob) };
      }
    }
    if (item.dataUrl?.startsWith('blob:')) {
      return { ...item, dataUrl: undefined };
    }
    return item;
  };

  return {
    ...project,
    videoClips: await Promise.all(project.videoClips.map(restore)),
    audioTracks: await Promise.all(project.audioTracks.map(restore)),
  };
}

export function exportProjectAsJSON(project: ProjectData): void {
  // Projects saved by earlier versions may still carry the Claude API key; never write it into a shareable file
  const json = JSON.stringify(project, (key, value) => (key === 'claudeApiKey' ? undefined : value), 2);
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(json);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  const safeName = project.title.replace(/[/\\?%*:|"<>]/g, '_') || 'sacred_project';
  downloadAnchor.setAttribute('download', `${safeName}.sacred.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
