import React, { useSyncExternalStore } from 'react';
import { getPlayhead, subscribePlayhead } from '../services/playhead';

const exactTime = (time: number) => time;

/**
 * The playhead position, or something derived from it with `select`. The component is redrawn
 * only when the selected value changes: with no `select` that is every frame while playing, so
 * pass one (e.g. the time rounded to what is shown) wherever a coarser value will do.
 * `select` must return a plain value (number, string, boolean).
 */
export function usePlayhead(): number;
export function usePlayhead<T extends number | string | boolean>(select: (time: number) => T): T;
export function usePlayhead<T extends number | string | boolean>(select?: (time: number) => T): T | number {
  const pick = (select ?? exactTime) as (time: number) => T | number;
  return useSyncExternalStore(subscribePlayhead, () => pick(getPlayhead()));
}

/**
 * The playhead position as text, e.g. "12.3" (`digits={1}`) or "12" (`digits={0}`, rounded down).
 * On its own so that the panel around it is not redrawn as the playhead moves.
 */
export const PlayheadSeconds: React.FC<{ digits: 0 | 1 }> = ({ digits }) => {
  const text = usePlayhead((time) => (digits === 0 ? String(Math.floor(time)) : time.toFixed(1)));
  return <>{text}</>;
};
