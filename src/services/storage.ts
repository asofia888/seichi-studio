/**
 * IndexedDB storage for video/audio/image blobs and project persistence.
 * Several projects are kept side by side, each under its own slot; one of them is the current
 * project, which the app opens when it starts.
 */
import { ProjectData } from '../types';
import { normalizeProject } from './projectSchema';

const DB_NAME = 'SacredVideoStudioDB';
const DB_VERSION = 1;
const STORE_BLOBS = 'media_blobs';
const STORE_PROJECTS = 'projects';
// In the projects store: each project under PROJECT_KEY_PREFIX + its slot, and the slot of the current one
const PROJECT_KEY_PREFIX = 'project:';
const CURRENT_SLOT_KEY = 'current_project_slot';
// Kept next to the projects: when each stored file was first found unused (ms)
const UNUSED_MEDIA_KEY = 'unused_media_since';
// Earlier versions kept a single project under this key...
const LEGACY_PROJECT_KEY = 'last_project';
// ...and before that in localStorage (5MB limit, failed silently when full)
const LEGACY_LOCALSTORAGE_KEY = 'sacred_studio_last_project';

// Files no project uses are deleted only after this long, so a project file (.json)
// saved in the meantime still finds its media when it is loaded in this browser
export const UNUSED_MEDIA_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

const projectKey = (slotId: string) => PROJECT_KEY_PREFIX + slotId;
const allProjectKeys = () => IDBKeyRange.bound(PROJECT_KEY_PREFIX, PROJECT_KEY_PREFIX + '￿');

/** A new place to keep a project in */
export function newProjectSlot(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Resolves once everything written in `tx` is safely stored */
const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error); // e.g. the browser's storage is full
  });

// ---------------------------------------------------------------------------
// Media files
// ---------------------------------------------------------------------------

export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  tx.objectStore(STORE_BLOBS).put(blob, key);
  await transactionDone(tx);
  // Work worth keeping is now in this browser: ask it not to clear the storage on its own
  requestPersistentStorage();
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  const db = await openDatabase();
  const blob = await requestResult(db.transaction(STORE_BLOBS, 'readonly').objectStore(STORE_BLOBS).get(key));
  return blob || null;
}

export async function hasMediaBlob(key: string): Promise<boolean> {
  const db = await openDatabase();
  return (await requestResult(db.transaction(STORE_BLOBS, 'readonly').objectStore(STORE_BLOBS).count(key))) > 0;
}

/**
 * Keep a file the user added in this browser and return its key. The same file added again
 * (same name, size and modification time) reuses the stored copy instead of storing another one.
 */
export async function saveMediaFile(file: File): Promise<string> {
  const key = `file_${file.size}_${file.lastModified}_${file.name}`;
  if (!(await hasMediaBlob(key))) await saveMediaBlob(key, file);
  return key;
}

/** The media files a project plays */
export function mediaKeysInUse(project: ProjectData): Set<string> {
  return new Set(
    [...project.videoClips, ...project.audioTracks].flatMap((item) => (item.blobKey ? [item.blobKey] : []))
  );
}

/** The media files of a stored project, however incomplete it is (never throws) */
function mediaKeysOfStored(stored: unknown): string[] {
  const record = stored as { videoClips?: unknown; audioTracks?: unknown } | null;
  return [record?.videoClips, record?.audioTracks].flatMap((items) =>
    Array.isArray(items)
      ? items.flatMap((item) => (typeof item?.blobKey === 'string' && item.blobKey ? [item.blobKey as string] : []))
      : []
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
 * Delete stored files that neither `project` (the one being opened) nor any other stored project
 * has used for UNUSED_MEDIA_GRACE_MS. Run only at startup: during a session, undo can bring back
 * a clip whose file the current project no longer uses. Returns how many files were deleted.
 */
export async function cleanUpUnusedMedia(project: ProjectData, now = Date.now()): Promise<number> {
  const usedKeys = mediaKeysInUse(project);
  const db = await openDatabase();
  const tx = db.transaction([STORE_BLOBS, STORE_PROJECTS], 'readwrite');
  const blobs = tx.objectStore(STORE_BLOBS);
  const meta = tx.objectStore(STORE_PROJECTS);
  const keysReq = blobs.getAllKeys();
  const projectsReq = meta.getAll(allProjectKeys());
  const sinceReq = meta.get(UNUSED_MEDIA_KEY);
  let deleted = 0;
  // Requests in a transaction finish in order, so the keys and the projects are ready here too
  sinceReq.onsuccess = () => {
    for (const stored of projectsReq.result) {
      for (const key of mediaKeysOfStored(stored)) usedKeys.add(key);
    }
    const plan = planMediaCleanup(keysReq.result.map(String), usedKeys, sinceReq.result ?? {}, now);
    for (const key of plan.toDelete) blobs.delete(key);
    meta.put(plan.unusedSince, UNUSED_MEDIA_KEY);
    deleted = plan.toDelete.length;
  };
  await transactionDone(tx);
  return deleted;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function saveProjectToStorage(project: ProjectData, slotId: string): Promise<void> {
  const write = (db: IDBDatabase) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(project, projectKey(slotId));
    const done = transactionDone(tx);
    // Commit now rather than at the end of the task: a page being closed aborts unfinished transactions
    tx.commit?.();
    return done;
  };
  // Once the database is open, start the write synchronously: a save requested while the page
  // is closing (pagehide) must not wait for a later tick, or it never reaches the database
  await (openedDb ? write(openedDb) : openDatabase().then(write));
}

/** Make `slotId` the project the app opens when it starts (it need not hold a project yet) */
export async function setCurrentProjectSlot(slotId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  tx.objectStore(STORE_PROJECTS).put(slotId, CURRENT_SLOT_KEY);
  await transactionDone(tx);
}

/** A stored project as a complete project, or null when the slot is empty or holds something unusable */
function asProject(stored: unknown): ProjectData | null {
  if (!stored) return null;
  try {
    return normalizeProject(stored);
  } catch {
    return null;
  }
}

/** The single project an earlier version saved, if it is still there */
async function readLegacyProject(db: IDBDatabase): Promise<ProjectData | null> {
  const stored = await requestResult(
    db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).get(LEGACY_PROJECT_KEY)
  );
  const project = asProject(stored);
  if (project) return project;
  try {
    const cached = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    return cached ? asProject(JSON.parse(cached)) : null;
  } catch {
    return null;
  }
}

/**
 * The project to open at startup, with its media reconnected, and the slot it is kept in.
 * `project` is null when nothing has been saved in that slot yet (the first visit).
 */
export async function loadCurrentProject(): Promise<{ slotId: string; project: ProjectData | null }> {
  const db = await openDatabase();
  const store = () => db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS);
  const currentSlot: unknown = await requestResult(store().get(CURRENT_SLOT_KEY));

  if (typeof currentSlot === 'string' && currentSlot) {
    const project = asProject(await requestResult(store().get(projectKey(currentSlot))));
    return { slotId: currentSlot, project: project && (await restoreMediaUrls(project)) };
  }

  // The first start of this version: take over the project an earlier version saved
  const slotId = newProjectSlot();
  const legacy = await readLegacyProject(db);
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  if (legacy) tx.objectStore(STORE_PROJECTS).put(legacy, projectKey(slotId));
  tx.objectStore(STORE_PROJECTS).put(slotId, CURRENT_SLOT_KEY);
  tx.objectStore(STORE_PROJECTS).delete(LEGACY_PROJECT_KEY);
  await transactionDone(tx);
  try {
    localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
  } catch {}
  return { slotId, project: legacy && (await restoreMediaUrls(legacy)) };
}

/** A stored project as it was saved (its media not reconnected), or null */
export async function readStoredProject(slotId: string): Promise<ProjectData | null> {
  const db = await openDatabase();
  return asProject(
    await requestResult(db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).get(projectKey(slotId)))
  );
}

/** Switch to another stored project: it becomes the current one and is returned ready to edit */
export async function openStoredProject(slotId: string): Promise<ProjectData | null> {
  const project = await readStoredProject(slotId);
  if (!project) return null;
  await setCurrentProjectSlot(slotId);
  return restoreMediaUrls(project);
}

export interface StoredProjectInfo {
  slotId: string;
  title: string;
  updatedAt: string;
  duration: number;
  aspectRatio: ProjectData['aspectRatio'];
  clipCount: number;
  /** False when what is stored cannot be read as a project (it can only be deleted) */
  isReadable: boolean;
}

/** Every project kept in this browser, the most recently edited first */
export async function listStoredProjects(): Promise<StoredProjectInfo[]> {
  const db = await openDatabase();
  const store = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS);
  const keysReq = store.getAllKeys(allProjectKeys());
  const stored = await requestResult(store.getAll(allProjectKeys()));
  const infos = stored.map((value, i): StoredProjectInfo => {
    const slotId = String(keysReq.result[i]).slice(PROJECT_KEY_PREFIX.length);
    const project = asProject(value);
    return {
      slotId,
      title: project?.title ?? '（読み込めないプロジェクト）',
      updatedAt: project?.updatedAt ?? '',
      duration: project?.duration ?? 0,
      aspectRatio: project?.aspectRatio ?? '16:9',
      clipCount: project?.videoClips.length ?? 0,
      isReadable: project !== null,
    };
  });
  return infos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Its media files stay for UNUSED_MEDIA_GRACE_MS (see cleanUpUnusedMedia), unless another project uses them */
export async function deleteStoredProject(slotId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  tx.objectStore(STORE_PROJECTS).delete(projectKey(slotId));
  await transactionDone(tx);
}

/** Store a copy of a project (sharing its media files) and return the copy's slot, or null if there is nothing to copy */
export async function duplicateStoredProject(slotId: string): Promise<string | null> {
  const project = await readStoredProject(slotId);
  if (!project) return null;
  const copySlot = newProjectSlot();
  const now = new Date().toISOString();
  await saveProjectToStorage(
    { ...project, id: `project_${Date.now()}`, title: `${project.title} のコピー`, createdAt: now, updatedAt: now },
    copySlot
  );
  return copySlot;
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

// ---------------------------------------------------------------------------
// How safe the stored work is
// ---------------------------------------------------------------------------

const storageManager = (): StorageManager | undefined =>
  typeof navigator !== 'undefined' ? navigator.storage : undefined;

let persistenceRequest: Promise<boolean> | null = null;

/**
 * Ask the browser to keep this site's storage until the user clears it. Without this, a browser
 * short on disk space may delete everything stored here on its own. Asked once per visit
 * (again with `askAgain`, when the user asks for it); resolves to whether the storage is protected now.
 */
export function requestPersistentStorage(askAgain = false): Promise<boolean> {
  if (askAgain) persistenceRequest = null;
  persistenceRequest ??= (async () => {
    try {
      const storage = storageManager();
      if (!storage?.persist) return false;
      return (await storage.persisted()) || (await storage.persist());
    } catch {
      return false;
    }
  })();
  return persistenceRequest;
}

export interface StorageStatus {
  /** Bytes this site stores in the browser, and how many it may; null when the browser does not say */
  usage: number | null;
  quota: number | null;
  /** Whether the browser has promised not to clear the storage on its own; null when unknown */
  isPersistent: boolean | null;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  try {
    const estimate = await storage?.estimate?.();
    return {
      usage: estimate?.usage ?? null,
      quota: estimate?.quota ?? null,
      isPersistent: storage?.persisted ? await storage.persisted() : null,
    };
  } catch {
    return { usage: null, quota: null, isPersistent: null };
  }
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

export const safeFileName = (title: string, fallback: string) => title.replace(/[/\\?%*:|"<>]/g, '_') || fallback;

export function exportProjectAsJSON(project: ProjectData): void {
  // Projects saved by earlier versions may still carry the Claude API key; never write it into a shareable file
  const json = JSON.stringify(project, (key, value) => (key === 'claudeApiKey' ? undefined : value), 2);
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(json);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `${safeFileName(project.title, 'sacred_project')}.sacred.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
