import test from 'node:test';
import assert from 'node:assert/strict';
import {addRoutineBlock,moveRoutineBlock,newRoutineDraft,renameRoutineDraft,updateRoutineBlock} from './routineDraftEditor.ts';
import {applyRoutineDraftEdit,createRoutineDraftHistory,redoRoutineDraftEdit,undoRoutineDraftEdit} from './routineDraftHistory.ts';

test('routine undo/redo restores athlete-authored content and stable block identities',()=>{
 const base=createRoutineDraftHistory(newRoutineDraft('strength'));
 const named=applyRoutineDraftEdit(base,renameRoutineDraft(base.present,'Strength A'));
 const added=applyRoutineDraftEdit(named,addRoutineBlock(named.present));
 const id=added.present.blocks[0].id;
 const exercise=added.present.blocks[0];
 if(exercise.kind!=='strength')throw Error('Expected strength exercise');
 const edited=applyRoutineDraftEdit(added,updateRoutineBlock(added.present,{...exercise,exercise:'Squat',reps:'5',weight:'100 lb'}));
 assert.equal(edited.present.blocks[0].id,id);
 const backward=undoRoutineDraftEdit(edited);
 assert.equal((backward.present.blocks[0] as typeof exercise).exercise,'');
 assert.equal(backward.present.blocks[0].id,id);
 const forward=redoRoutineDraftEdit(backward);
 assert.equal((forward.present.blocks[0] as typeof exercise).exercise,'Squat');
 assert.equal(forward.present.blocks[0].id,id);
 assert.equal(base.present.blocks.length,0);
 assert.equal(forward.present.id,null);
 assert.equal(forward.present.status,'unsaved_draft');
});
test('new edit after undo clears redo and no-op does not grow history',()=>{
 const original=createRoutineDraftHistory(newRoutineDraft());
 const same=applyRoutineDraftEdit(original,original.present);
 assert.equal(same,original);
 const a=applyRoutineDraftEdit(original,addRoutineBlock(original.present));
 const undone=undoRoutineDraftEdit(a);
 const changed=applyRoutineDraftEdit(undone,renameRoutineDraft(undone.present,'New intent'));
 assert.equal(changed.redo.length,0);
 assert.equal(redoRoutineDraftEdit(changed),changed);
});
test('history is bounded even after rapid text input and cannot mutate past snapshots',()=>{
 let state=createRoutineDraftHistory(newRoutineDraft('swimming'));
 for(let i=0;i<90;i++)state=applyRoutineDraftEdit(state,renameRoutineDraft(state.present,'Swim '+i));
 assert.equal(state.undo.length,40);
 assert.equal(state.redo.length,0);
 const old=undoRoutineDraftEdit(state);
 assert.equal(state.present.name,'Swim 89');
 assert.equal(old.present.name,'Swim 88');
 assert.notEqual(old.present,state.present);
});
test('interval reorder can undo and redo in its original version',()=>{
 let state=createRoutineDraftHistory(newRoutineDraft('running'));
 state=applyRoutineDraftEdit(state,addRoutineBlock(state.present));
 state=applyRoutineDraftEdit(state,addRoutineBlock(state.present));
 const first=state.present.blocks[0].id;
 const moved=applyRoutineDraftEdit(state,moveRoutineBlock(state.present,first,1));
 assert.equal(moved.present.blocks[1].id,first);
 assert.equal(undoRoutineDraftEdit(moved).present.blocks[0].id,first);
 assert.equal(redoRoutineDraftEdit(undoRoutineDraftEdit(moved)).present.blocks[1].id,first);
});
