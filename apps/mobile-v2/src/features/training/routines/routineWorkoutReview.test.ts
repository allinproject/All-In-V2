import test from 'node:test';
import assert from 'node:assert/strict';
import {
 openOwnedRoutineWorkoutReview,reviewCoachRoutineSuggestion,
 keepOriginalRoutineWorkout,applyCoachChangeForSession,
 type SavedRoutineOwnerSnapshot,type CoachRoutineSuggestion,
} from './routineWorkoutReview.ts';

const snapshot:SavedRoutineOwnerSnapshot={
 identity:'canonical_saved_routine',routineId:'routine-a',ownerId:'athlete-a',
 version:7,sessionGeneration:12,complete:true,name:'Strength A',
 sport:'strength',notes:'Original remains unchanged',
 blocks:[{kind:'strength',id:'draft-1',exercise:'Squat',equipment:'barbell',
  notes:'',sets:3,reps:'6',weight:'95 lb',restSeconds:90,
  setType:'working',groupId:null}],
};
const proposal:CoachRoutineSuggestion={
 identity:'coach_routine_proposal_only',proposalId:'coach-proposal-1',
 ownerId:'athlete-a',sessionGeneration:12,routineId:'routine-a',
 routineVersion:7,evidenceRefs:['completed-activity-42','recovery-3'],
 rationale:'Review a smaller dose based on verified recovery context.',
 blockId:'draft-1',
 replacement:{...snapshot.blocks[0],sets:2},
};
test('certified owner session identity is required to open a saved routine',()=>{
 assert.equal(openOwnedRoutineWorkoutReview(snapshot,'athlete-b',12),null);
 assert.equal(openOwnedRoutineWorkoutReview(snapshot,'athlete-a',13),null);
 assert.equal(openOwnedRoutineWorkoutReview({...snapshot,complete:false} as typeof snapshot,'athlete-a',12),null);
 assert.equal(openOwnedRoutineWorkoutReview({...snapshot,version:0},'athlete-a',12),null);
 assert.equal(openOwnedRoutineWorkoutReview(snapshot,'athlete-a',12)?.suggestionStatus,'none');
});
test('Coach suggestion does not apply automatically; athlete applies only to this preview',()=>{
 const original=openOwnedRoutineWorkoutReview(snapshot,'athlete-a',12)!;
 const pending=reviewCoachRoutineSuggestion(original,proposal,'athlete-a',12);
 assert.equal(pending.suggestionStatus,'proposed');
 assert.equal((pending.sessionDraft.blocks[0] as typeof snapshot.blocks[0]).sets,3);
 const applied=applyCoachChangeForSession(pending,'athlete-a',12);
 assert.equal(applied.suggestionStatus,'applied_for_session');
 assert.equal((applied.sessionDraft.blocks[0] as typeof snapshot.blocks[0]).sets,2);
 assert.equal((applied.original.blocks[0] as typeof snapshot.blocks[0]).sets,3);
 assert.equal((snapshot.blocks[0] as typeof snapshot.blocks[0]).sets,3);
 assert.equal(applied.planMutation,false);
 const kept=keepOriginalRoutineWorkout(applied);
 assert.equal(kept.suggestionStatus,'kept_original');
 assert.equal((kept.sessionDraft.blocks[0] as typeof snapshot.blocks[0]).sets,3);
});
test('rejects stale revision, wrong account, missing evidence and changed block identities',()=>{
 const original=openOwnedRoutineWorkoutReview(snapshot,'athlete-a',12)!;
 for(const p of [
  {...proposal,ownerId:'athlete-b'},
  {...proposal,sessionGeneration:13},
  {...proposal,routineVersion:8},
  {...proposal,routineId:'routine-b'},
  {...proposal,evidenceRefs:[]},
  {...proposal,replacement:{...proposal.replacement,id:'draft-2'}},
  {...proposal,blockId:'draft-3'},
  {...proposal,replacement:{...proposal.replacement,sets:80}},
 ]){
  assert.equal(reviewCoachRoutineSuggestion(original,p,'athlete-a',12),original);
 }
 assert.equal(reviewCoachRoutineSuggestion(original,proposal,'athlete-b',12),original);
 assert.equal(reviewCoachRoutineSuggestion(original,proposal,'athlete-a',13),original);
});
test('declining suggested change does not change source, accepted plan or current session',()=>{
 const initial=openOwnedRoutineWorkoutReview(snapshot,'athlete-a',12)!;
 const pending=reviewCoachRoutineSuggestion(initial,proposal,'athlete-a',12);
 const declined=keepOriginalRoutineWorkout(pending);
 assert.equal(declined.suggestionStatus,'kept_original');
 assert.equal(applyCoachChangeForSession(declined,'athlete-a',12),declined);
 assert.equal((declined.sessionDraft.blocks[0] as typeof snapshot.blocks[0]).sets,3);
 assert.equal(declined.original,initial.original);
});
