import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissNotice, getNotices, notify, subscribeNotices } from './notifications';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  getNotices().forEach((n) => dismissNotice(n.id));
  vi.useRealTimers();
});

const messages = () => getNotices().map((n) => n.message);

describe('notify', () => {
  it('hides a hint after a few seconds but keeps an error until it is closed', () => {
    notify('ヒント');
    notify('エラー', 'error');
    vi.advanceTimersByTime(60_000);
    expect(messages()).toEqual(['エラー']);

    dismissNotice(getNotices()[0].id);
    expect(messages()).toEqual([]);
  });

  it('shows the same message once, as the newest', () => {
    notify('A', 'error');
    notify('B', 'error');
    notify('A', 'error');
    expect(messages()).toEqual(['B', 'A']);
  });

  it('shows at most four notices, dropping the oldest', () => {
    for (const m of ['1', '2', '3', '4', '5']) notify(m, 'error');
    expect(messages()).toEqual(['2', '3', '4', '5']);
  });

  it('tells subscribers about every change until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNotices(listener);
    notify('A', 'error');
    dismissNotice(getNotices()[0].id);
    unsubscribe();
    notify('B', 'error');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
