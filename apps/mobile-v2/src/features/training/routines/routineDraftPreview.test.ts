import test from 'node:test';
import assert from 'node:assert/strict';
import {addRoutineBlock,newRoutineDraft,updateRoutineBlock} from './routineDraftEditor.ts';
import {projectRoutineDraftPreview} from './routineDraftPreview.ts';

test('strength preview reports only explicit authored prescriptions and no guessed weights',()=>{
 let draft=addRoutineBlock(newRoutineDraft('strength'));
 const first=draft.blocks[0];
 if(first.kind!=='strength')throw Error('Expected strength');
 draft=updateRoutineBlock(draft,{...first,exercise:'Bench Press',sets:3,reps:'8',weight:null,restSeconds:90});
 const review=projectRoutineDraftPreview(draft);
 assert.equal(review.ready,true);
 assert.equal(review.rows[0].title,'1. Bench Press');
 assert.ok(review.rows[0].details.includes('3 working sets'));
 assert.ok(review.rows[0].details.includes('Reps: 8'));
 assert.ok(!review.rows[0].details.some(line=>line.startsWith('Load:')));
 assert.equal(review.totalDurationSeconds,null);
});
test('interval preview calculates duration only when every block has explicit duration',()=>{
 let draft=addRoutineBlock(newRoutineDraft('running'));
 const first=draft.blocks[0];
 if(first.kind!=='interval')throw Error('Expected interval');
 draft=updateRoutineBlock(draft,{...first,phase:'work',repetitions:4,durationSeconds:120,
  distance:null,distanceUnit:null,effort:'RPE 7'});
 let review=projectRoutineDraftPreview(draft);
 assert.equal(review.totalDurationSeconds,480);
 draft=addRoutineBlock(draft);
 review=projectRoutineDraftPreview(draft);
 assert.equal(review.totalDurationSeconds,null);
 assert.equal(review.ready,false);
});
test('distance-only swim interval does not invent duration and preserves provided unit',()=>{
 let draft=addRoutineBlock(newRoutineDraft('swimming'));
 const first=draft.blocks[0];
 if(first.kind!=='interval')throw Error('Expected interval');
 draft=updateRoutineBlock(draft,{...first,phase:'work',repetitions:6,distance:50,
  distanceUnit:'yards',durationSeconds:null});
 const review=projectRoutineDraftPreview(draft);
 assert.equal(review.ready,true);
 assert.equal(review.totalDurationSeconds,null);
 assert.ok(review.rows[0].details.includes('Distance: 50 yards per repetition'));
});
