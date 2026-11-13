import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCompletedActivityRoutinePreview,type ConfirmedRoutineSource} from './completedActivityRoutinePreview.ts';

const base:ConfirmedRoutineSource={
 activityId:'activity-a',activityVersion:3,ownerId:'athlete-a',
 sport:'strength',title:'Strength Session',structuredEvidenceVersion:2,
 complete:true,actualStructureCount:2,
 prescribedBlocks:[
  {kind:'strength',sourceBlockId:'set-group-1',exercise:'Squat',sets:3,reps:'6-8',
   weight:null,restSeconds:90,equipment:'barbell',notes:'',setType:'working',groupId:null},
 ],
};
test('conversion only copies actual pre-workout prescriptions, not performed measurements',()=>{
 const preview=prepareCompletedActivityRoutinePreview(base,'athlete-a');
 assert.equal(preview?.status,'requires_manual_review');
 assert.equal(preview?.excludedBlocks,1);
 assert.equal(preview?.draft.blocks.length,1);
 assert.deepEqual(preview?.blockLineage,[{draftBlockId:preview?.draft.blocks[0].id,sourceBlockId:'set-group-1'}]);
 assert.equal(preview?.draft.id,null);
 assert.equal(preview?.draft.sourceCompletionId,null);
 assert.equal(preview?.draft.status,'unsaved_draft');
 const block=preview?.draft.blocks[0];
 assert.equal(block?.kind,'strength');
 if(block?.kind==='strength'){
  assert.equal(block.exercise,'Squat');
  assert.equal(block.weight,null);
 }
 assert.deepEqual(preview?.source,{activityId:'activity-a',activityVersion:3,
  structuredEvidenceVersion:2});
});

test('rejects cross-owner, stale/partial sources and unbounded source identities',()=>{
 assert.equal(prepareCompletedActivityRoutinePreview(base,'athlete-b'),null);
 assert.equal(prepareCompletedActivityRoutinePreview({...base,complete:false},'athlete-a'),null);
 assert.equal(prepareCompletedActivityRoutinePreview({...base,activityVersion:0},'athlete-a'),null);
 assert.equal(prepareCompletedActivityRoutinePreview({...base,
  prescribedBlocks:[base.prescribedBlocks[0],base.prescribedBlocks[0]]},'athlete-a'),null);
});

test('does not invent routine targets from a completion with measured-only details',()=>{
 const preview=prepareCompletedActivityRoutinePreview({...base,prescribedBlocks:[],
  actualStructureCount:5},'athlete-a');
 assert.equal(preview?.draft.blocks.length,0);
 assert.equal(preview?.status,'requires_manual_review');
 assert.equal(preview?.excludedBlocks,5);
 assert.match(preview?.notes.join(' ')??'',/Build a routine manually/);
});

test('approved complete endurance prescriptions retain explicit authored units and phase',()=>{
 const source:ConfirmedRoutineSource={...base,sport:'swimming',
  actualStructureCount:1,prescribedBlocks:[
   {kind:'interval',sourceBlockId:'interval-1',phase:'work',repetitions:8,
    durationSeconds:null,distance:50,distanceUnit:'yards',effort:'RPE 5',notes:''},
  ]};
 const preview=prepareCompletedActivityRoutinePreview(source,'athlete-a');
 assert.equal(preview?.status,'ready_for_athlete_review');
 const block=preview?.draft.blocks[0];
 assert.equal(block?.kind,'interval');
 if(block?.kind==='interval'){
  assert.equal(block.distance,50);
  assert.equal(block.distanceUnit,'yards');
  assert.equal(block.durationSeconds,null);
 }
});
