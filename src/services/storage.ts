/**
 * IndexedDB storage for video/audio/image blobs and project persistence
 */
import { ProjectData } from '../types';

const DB_NAME = 'SacredVideoStudioDB';
const DB_VERSION = 1;
const STORE_BLOBS = 'media_blobs';
const STORE_PROJECTS = 'projects';
const LAST_PROJECT_KEY = 'last_project';
// Earlier versions kept the project in localStorage (5MB limit, failed silently when full)
const LEGACY_LOCALSTORAGE_KEY = 'sacred_studio_last_project';

// Reuse one connection instead of opening a new one on every save
let dbPromise: Promise<IDBDatabase> | null = null;

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
    request.onsuccess = () => resolve(request.result);
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

export async function deleteMediaBlob(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectToStorage(project: ProjectData): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(project, LAST_PROJECT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

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
