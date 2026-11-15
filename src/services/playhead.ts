/**
 * The playhead: where on the timeline the editor is, in seconds.
 *
 * It lives outside React because it changes on every frame while playing. Components that show
 * the moving playhead subscribe to it (see usePlayhead) and are the only ones redrawn per frame;
 * everything else reads it when it needs it (e.g. "add a telop at the playhead").
 */

let time = 0;
const listeners = new Set<() => void>();

export const getPlayhead = (): number => time;

/** Move the playhead to a time, or to one derived from where it is now. Never before 0. */
export function setPlayhead(next: number | ((current: number) => number)): void {
  const value = Math.max(0, typeof next === 'function' ? next(time) : next);
  if (!Number.isFinite(value) || value === time) return;
  time = value;
  listeners.forEach((listener) => listener());
}

/** For useSyncExternalStore, and for anything that must follow the playhead (the sound) */
export function subscribePlayhead(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
