import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveWatchExecutionCommand,type WatchExecutionCommandInput} from './watchExecutionCommandGate.ts';
const input=():WatchExecutionCommandInput=>({
 attachment:{expectedOwnerId:'owner-a',authenticatedOwnerId:'owner-a',accessGateReady:true,
  watchOwnerId:'owner-a',watchInstanceId:'one-session',watchKnownSessionVersion:7,
  permission:'granted',connectedToCanonicalWriter:true,
  session:{instanceId:'one-session',ownerId:'owner-a',revisionSessionId:'workout-revision',status:'active',version:7}},
 action:'pause',clientActionId:'pause-action-1',expectedSessionVersion:7,intendedSessionId:'one-session',
});
test('pause is only a guarded submission plan for the exact active session',()=>{
 assert.deepEqual(resolveWatchExecutionCommand(input()),{kind:'submit_to_training_writer',
  instanceId:'one-session',clientActionId:'pause-action-1',expectedSessionVersion:7,
  action:'pause',noLocalCommit:true});
});
test('resume and finish require appropriate canonical states',()=>{
 const paused=input();paused.action='resume';paused.attachment.session={...paused.attachment.session!,status:'paused'};
 assert.equal(resolveWatchExecutionCommand(paused).kind,'submit_to_training_writer');
 const finish=input();finish.action='request_finish';
 assert.equal(resolveWatchExecutionCommand(finish).kind,'submit_to_training_writer');
 finish.attachment.session={...finish.attachment.session!,status:'finishing'};
 assert.deepEqual(resolveWatchExecutionCommand(finish),{kind:'blocked',reason:'finish_already_in_progress',noLocalCommit:true});
 const bad=input();bad.action='resume';
 assert.equal(resolveWatchExecutionCommand(bad).kind,'blocked');
});
test('offline or missing canonical read can never confirm a command',()=>{
 for(const patch of [{connectedToCanonicalWriter:false},{session:undefined}]){
  const x=input();x.attachment={...x.attachment,...patch};
  assert.equal(resolveWatchExecutionCommand(x).kind,'reconcile');
 }
});
test('old Watch versions and server races are not silently rebased',()=>{
 const prior=input();prior.attachment.watchKnownSessionVersion=6;
 assert.deepEqual(resolveWatchExecutionCommand(prior),{kind:'reconcile',
  reason:'stale_watch_command_requires_reconciliation',noLocalCommit:true});
 const changed=input();changed.attachment.session={...changed.attachment.session!,version:8};
 assert.equal(resolveWatchExecutionCommand(changed).kind,'reconcile');
 const future=input();future.attachment.watchKnownSessionVersion=8;
 assert.equal(resolveWatchExecutionCommand(future).kind,'reconcile');
});
test('session switch cannot move a pending finish onto a different workout',()=>{
 const changed=input();changed.intendedSessionId='different';changed.action='request_finish';
 assert.equal(resolveWatchExecutionCommand(changed).kind,'reconcile');
 const swapped=input();swapped.attachment.watchInstanceId='different';
 assert.equal(resolveWatchExecutionCommand(swapped).kind,'reconcile');
});
test('sign out, account switch and denied Watch permissions block command',()=>{
 for(const patch of [{authenticatedOwnerId:null},{watchOwnerId:'owner-b'},{permission:'denied' as const}]){
  const x=input();x.attachment={...x.attachment,...patch};
  assert.equal(resolveWatchExecutionCommand(x).kind,'blocked');
 }
});
test('invalid action IDs and malformed version prevent untraceable commands',()=>{
 for(const patch of [{clientActionId:''},{clientActionId:'x'.repeat(129)},
   {intendedSessionId:''},{expectedSessionVersion:-1},{expectedSessionVersion:1.5},
   {action:'new-workout' as WatchExecutionCommandInput['action']}]){
  assert.deepEqual(resolveWatchExecutionCommand({...input(),...patch}),{kind:'blocked',
   reason:'invalid_command_identity_or_version',noLocalCommit:true});
 }
});
test('terminal session cannot accept duplicate completion command',()=>{
 const x=input();x.action='request_finish';x.attachment.session={...x.attachment.session!,status:'completed'};
 assert.equal(resolveWatchExecutionCommand(x).kind,'blocked');
});
