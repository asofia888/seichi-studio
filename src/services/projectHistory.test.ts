import { describe, expect, it } from 'vitest';
import { createHistory, historyReducer, ProjectHistory } from './projectHistory';
import { makeProject } from '../test/makeProject';

const titled = (title: string) => makeProject({ title });
const edit = (state: ProjectHistory, title: string, at: number) =>
  historyReducer(state, { type: 'update', update: titled(title), at });

describe('historyReducer', () => {
  it('undoes and redoes edits made apart from each other one at a time', () => {
    let h = createHistory(titled('A'));
    h = edit(h, 'B', 10_000);
    h = edit(h, 'C', 20_000);

    h = historyReducer(h, { type: 'undo' });
    expect(h.present.title).toBe('B');
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.title).toBe('A');
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.title).toBe('B');
  });

  it('undoes a burst of quick edits (typing, dragging) in one step', () => {
    let h = createHistory(titled('A'));
    h = edit(h, 'Ab', 10_000);
    h = edit(h, 'Abc', 10_300);
    h = edit(h, 'Abcd', 10_600);

    h = historyReducer(h, { type: 'undo' });
    expect(h.present.title).toBe('A');
    expect(h.past).toHaveLength(0);
  });

  it('starts a new undo step after an undo, even right away', () => {
    let h = createHistory(titled('A'));
    h = edit(h, 'B', 10_000);
    h = historyReducer(h, { type: 'undo' });
    h = edit(h, 'C', 10_100);

    expect(h.future).toHaveLength(0); // the undone edit cannot be redone over a new one
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.title).toBe('A');
  });

  it('applies an update function to the latest project', () => {
    let h = createHistory(titled('A'));
    h = edit(h, 'B', 10_000);
    h = historyReducer(h, { type: 'update', update: (p) => ({ ...p, title: `${p.title}!` }), at: 20_000 });
    expect(h.present.title).toBe('B!');
  });

  it('records nothing when the update returns the same project', () => {
    const h = createHistory(titled('A'));
    expect(historyReducer(h, { type: 'update', update: (p) => p, at: 10_000 })).toBe(h);
  });

  it('keeps at most 50 undo steps', () => {
    let h = createHistory(titled('0'));
    for (let i = 1; i <= 60; i++) h = edit(h, String(i), i * 10_000);
    expect(h.past).toHaveLength(50);
    expect(h.past[0].title).toBe('10');
  });

  it('does nothing on undo or redo with no history', () => {
    const h = createHistory(titled('A'));
    expect(historyReducer(h, { type: 'undo' })).toBe(h);
    expect(historyReducer(h, { type: 'redo' })).toBe(h);
  });

  it('starts a fresh history when a project is loaded', () => {
    let h = createHistory(titled('A'));
    h = edit(h, 'B', 10_000);
    h = historyReducer(h, { type: 'load', project: titled('Loaded') });
    expect(h.present.title).toBe('Loaded');
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(0);
  });
});
