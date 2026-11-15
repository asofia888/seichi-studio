import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlayhead, setPlayhead, subscribePlayhead } from './playhead';

beforeEach(() => setPlayhead(0));

describe('playhead', () => {
  it('moves to a time, or relative to where it is', () => {
    setPlayhead(5);
    setPlayhead((t) => t + 1.5);
    expect(getPlayhead()).toBe(6.5);
  });

  it('never goes before the start, and ignores a time that is not a number', () => {
    setPlayhead(3);
    setPlayhead(-2);
    expect(getPlayhead()).toBe(0);
    setPlayhead(4);
    setPlayhead(NaN);
    expect(getPlayhead()).toBe(4);
  });

  it('tells its subscribers only when it actually moved', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlayhead(listener);
    setPlayhead(2);
    setPlayhead(2);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setPlayhead(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
