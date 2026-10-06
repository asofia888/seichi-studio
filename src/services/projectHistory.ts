/**
 * Project state with undo/redo history (a pure reducer for useReducer)
 */
import { ProjectData } from '../types';

/**
 * A new project, or a function that derives it from the latest project.
 * Use the function form after anything asynchronous (await, file reading), so edits
 * made in the meantime are kept instead of being overwritten by an older copy.
 */
export type ProjectUpdate = ProjectData | ((prev: ProjectData) => ProjectData);

export interface ProjectHistory {
  past: ProjectData[];
  present: ProjectData;
  future: ProjectData[];
  /** Time of the last edit (ms); edits closer together than COALESCE_MS share one undo step */
  lastEditAt: number;
}

export type HistoryAction =
  | { type: 'update'; update: ProjectUpdate; at: number }
  | { type: 'load'; project: ProjectData }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_UNDO_STEPS = 50;
// Typing a sentence or dragging a slider is one burst of edits and undoes in one step
const COALESCE_MS = 800;

export function createHistory(project: ProjectData): ProjectHistory {
  return { past: [], present: project, future: [], lastEditAt: 0 };
}

export function historyReducer(state: ProjectHistory, action: HistoryAction): ProjectHistory {
  switch (action.type) {
    case 'update': {
      const next = typeof action.update === 'function' ? action.update(state.present) : action.update;
      if (next === state.present) return state;
      const continuesBurst = action.at - state.lastEditAt < COALESCE_MS;
      return {
        past: continuesBurst ? state.past : [...state.past, state.present].slice(-MAX_UNDO_STEPS),
        present: next,
        future: [],
        lastEditAt: action.at,
      };
    }
    case 'load':
      return createHistory(action.project);
    case 'undo': {
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        lastEditAt: 0,
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present].slice(-MAX_UNDO_STEPS),
        present: state.future[0],
        future: state.future.slice(1),
        lastEditAt: 0,
      };
    }
  }
}
