import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveWatchWriterAcknowledgement,type WatchAcknowledgementInput,type TrainingWriterAcknowledgement} from './watchWriterAcknowledgement.ts';
const cmd={kind:'submit_to_training_writer' as const,instanceId:'session-a',clientActionId:'action-1',expectedSessionVersion:4,action:'pause' as const,noLocalCommit:true as const};
const receipt=():TrainingWriterAcknowledgement=>({ownerId:'athlete-1',instanceId:'session-a',clientActionId:'action-1',expectedSessionVersion:4,resultSessionVersion:5,action:'pause',resultState:'paused',committed:true});
const sample=():WatchAcknowledgementInput=>({authenticatedOwnerId:'athlete-1',expectedOwnerId:'athlete-1',submitted:cmd,receipt:receipt()});

test('only exact committed canonical pause receipt confirms state',()=>{
 assert.deepEqual(resolveWatchWriterAcknowledgement(sample()),{kind:'confirmed',instanceId:'session-a',action:'pause',sessionVersion:5,displayState:'paused',completionPending:false});
});
test('resume confirms active and finish remains pending a separate Completed Activity commit',()=>{
 const x=sample();x.submitted={...cmd,action:'resume'};x.receipt={...receipt(),action:'resume',resultState:'active'};
 assert.deepEqual(resolveWatchWriterAcknowledgement(x),{kind:'confirmed',instanceId:'session-a',action:'resume',sessionVersion:5,displayState:'active',completionPending:false});
 x.submitted={...cmd,action:'request_finish'};x.receipt={...receipt(),action:'request_finish',resultState:'finishing'};
 assert.deepEqual(resolveWatchWriterAcknowledgement(x),{kind:'confirmed',instanceId:'session-a',action:'request_finish',sessionVersion:5,displayState:'finishing',completionPending:true});
});
test('missing receipt never turns network timeout into confirmed state',()=>{
 for(const missing of [undefined,null]){
  const x=sample();x.receipt=missing;
  assert.deepEqual(resolveWatchWriterAcknowledgement(x),{kind:'pending',reason:'canonical_writer_receipt_missing',noConfirmedState:true});
 }
});
test('signout and different authenticated user invalidate even an otherwise valid receipt',()=>{
 for(const value of [null,'athlete-2']){
  const x=sample();x.authenticatedOwnerId=value;
  assert.equal(resolveWatchWriterAcknowledgement(x).kind,'blocked');
 }
});
test('receipt mismatching owner, session, action identity or expected version demands reconciliation',()=>{
 const variants=[{ownerId:'athlete-2'},{instanceId:'session-b'},{clientActionId:'action-2'},
  {expectedSessionVersion:3},{action:'resume' as const},{committed:false as true}];
 for(const patch of variants){
  const x=sample();x.receipt={...receipt(),...patch};
  assert.deepEqual(resolveWatchWriterAcknowledgement(x),{kind:'reconcile',reason:'writer_receipt_identity_or_version_mismatch',noConfirmedState:true});
 }
});
test('stale, invalid and non-incrementing writer versions cannot confirm',()=>{
 for(const version of [4,3,4.5,Number.NaN,Infinity]){
  const x=sample();x.receipt={...receipt(),resultSessionVersion:version};
  assert.equal(resolveWatchWriterAcknowledgement(x).kind,'reconcile');
 }
});
test('a terminal completed status cannot masquerade as committed finish request',()=>{
 const x=sample();x.submitted={...cmd,action:'request_finish'};
 x.receipt={...receipt(),action:'request_finish',resultState:'completed'};
 assert.deepEqual(resolveWatchWriterAcknowledgement(x),{kind:'reconcile',reason:'writer_receipt_state_mismatch',noConfirmedState:true});
});
test('no approved submission cannot be upgraded into a writer confirmation',()=>{
 const x=sample();x.submitted={kind:'reconcile',reason:'offline',noLocalCommit:true};
 assert.equal(resolveWatchWriterAcknowledgement(x).kind,'blocked');
});
