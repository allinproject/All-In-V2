import test from 'node:test';
import assert from 'node:assert/strict';
import {
 addRoutineBlock,changeRoutineSport,deleteRoutineBlock,duplicateRoutineBlock,
 inspectRoutineDraft,moveRoutineBlock,newRoutineDraft,renameRoutineDraft,
 updateRoutineBlock,
} from './routineDraftEditor.ts';

test('strength editor preserves ordered prescribed sets but no fake completion or accepted plan',()=>{
 let draft=addRoutineBlock(newRoutineDraft('strength'));
 const block=draft.blocks[0];
 assert.equal(block.kind,'strength');
 assert.equal(draft.id,null);
 assert.equal(draft.sourceCompletionId,null);
 assert.equal(draft.status,'unsaved_draft');
 assert.equal(inspectRoutineDraft(draft).ready,false);
 if(block.kind!=='strength')throw new Error('Unexpected block');
 draft=renameRoutineDraft(draft,'Full Body A');
 draft=updateRoutineBlock(draft,{...block,exercise:'Squat',sets:3,reps:'6-8',
   weight:null,restSeconds:120,setType:'working'});
 assert.equal(inspectRoutineDraft(draft).ready,true);
 assert.equal(draft.blocks[0].kind,'strength');
 const duplicate=duplicateRoutineBlock(draft,block.id);
 assert.equal(duplicate.blocks.length,2);
 assert.notEqual(duplicate.blocks[0].id,duplicate.blocks[1].id);
 assert.equal(deleteRoutineBlock(duplicate,block.id).blocks.length,1);
});

test('interval editor supports explicit duration/distance with units and no invented targets',()=>{
 let draft=addRoutineBlock(newRoutineDraft('swimming'));
 const initial=draft.blocks[0];
 assert.equal(initial.kind,'interval');
 assert.equal(inspectRoutineDraft(draft).ready,false);
 if(initial.kind!=='interval')throw new Error('Unexpected block');
 draft=updateRoutineBlock(draft,{...initial,phase:'work',repetitions:6,
  distance:100,distanceUnit:'yards',durationSeconds:null,
  effort:'moderate RPE, athlete-authored'});
 assert.equal(inspectRoutineDraft(draft).ready,true);
 assert.equal(draft.blocks[0].kind,'interval');
 assert.equal((draft.blocks[0] as typeof initial).distanceUnit,'yards');
});

test('editing and reordering blocks preserves stable IDs and does not mutate source',()=>{
 let original=addRoutineBlock(newRoutineDraft('running'));
 original=addRoutineBlock(original);
 const ids=original.blocks.map(b=>b.id);
 const moved=moveRoutineBlock(original,ids[0],1);
 assert.deepEqual(moved.blocks.map(b=>b.id),ids.toReversed());
 assert.deepEqual(original.blocks.map(b=>b.id),ids);
 const unchanged=moveRoutineBlock(original,ids[0],-1);
 assert.equal(unchanged,original);
});

test('changing sports clears incompatible prescription only after explicit model change',()=>{
 let draft=addRoutineBlock(newRoutineDraft('strength'));
 const switched=changeRoutineSport(draft,'cycling');
 assert.equal(switched.sport,'cycling');
 assert.equal(switched.blocks.length,0);
 assert.equal(switched.name,draft.name);
 assert.equal(draft.blocks.length,1);
 assert.equal(switched.id,null);
 assert.equal(inspectRoutineDraft(switched).ready,false);
});

test('malformed, duplicated and cross-type blocks cannot pass review',()=>{
 let draft=addRoutineBlock(newRoutineDraft('strength'));
 const block=draft.blocks[0];
 if(block.kind!=='strength')throw new Error('Unexpected block');
 draft=updateRoutineBlock(draft,{...block,exercise:'Deadlift',sets:3,reps:'5'});
 const invalid={...draft,blocks:[draft.blocks[0],draft.blocks[0]]};
 assert.equal(inspectRoutineDraft(invalid).ready,false);
 const invalidLoad={...draft,blocks:[{...draft.blocks[0],sets:999}]};
 assert.equal(inspectRoutineDraft(invalidLoad).ready,false);
 const corrupted={...draft,id:'other-owner-template'} as unknown as typeof draft;
 assert.equal(inspectRoutineDraft(corrupted).ready,false);
});
