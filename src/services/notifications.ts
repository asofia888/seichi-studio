/**
 * On-screen notices that replace alert(): they never block editing, and can be raised from anywhere
 */

export type NoticeKind = 'info' | 'error';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

// Hints go away on their own; errors stay until closed so they are never missed
const INFO_DISPLAY_MS = 4000;
const MAX_NOTICES = 4;

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const publish = (next: Notice[]) => {
  notices = next;
  listeners.forEach((listener) => listener());
};

export function notify(message: string, kind: NoticeKind = 'info'): void {
  const id = nextId++;
  // The same message again (e.g. pressing S twice) is shown once, as the newest
  publish([...notices.filter((n) => n.message !== message), { id, kind, message }].slice(-MAX_NOTICES));
  if (kind === 'info') setTimeout(() => dismissNotice(id), INFO_DISPLAY_MS);
}

export function dismissNotice(id: number): void {
  if (notices.some((n) => n.id === id)) publish(notices.filter((n) => n.id !== id));
}

/** For useSyncExternalStore */
export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotices(): Notice[] {
  return notices;
}
