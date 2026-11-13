/**
 * ALL-246 in-session Routine editor undo/redo.
 * History is private React state, not a second persisted routine store. No
 * draft in this history grants authority to save, start or modify Training.
 */
import type {RoutineDraft} from './routineDraftEditor.ts';
export type RoutineDraftHistory={present:RoutineDraft;undo:RoutineDraft[];redo:RoutineDraft[]};
const HISTORY_LIMIT=40;
export function createRoutineDraftHistory(draft:RoutineDraft):RoutineDraftHistory{
 return {present:draft,undo:[],redo:[]};
}
export function applyRoutineDraftEdit(state:RoutineDraftHistory,next:RoutineDraft):RoutineDraftHistory{
 if(next===state.present)return state;
 return {present:next,undo:[...state.undo,state.present].slice(-HISTORY_LIMIT),redo:[]};
}
export function undoRoutineDraftEdit(state:RoutineDraftHistory):RoutineDraftHistory{
 if(!state.undo.length)return state;
 const before=state.undo.at(-1)!;
 return {present:before,undo:state.undo.slice(0,-1),
  redo:[state.present,...state.redo].slice(0,HISTORY_LIMIT)};
}
export function redoRoutineDraftEdit(state:RoutineDraftHistory):RoutineDraftHistory{
 if(!state.redo.length)return state;
 const next=state.redo[0];
 return {present:next,undo:[...state.undo,state.present].slice(-HISTORY_LIMIT),
  redo:state.redo.slice(1)};
}
