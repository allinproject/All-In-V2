import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveWatchSessionAttachment, type WatchSessionAttachmentInput} from './watchSessionAttachment.ts';

const fixture=():WatchSessionAttachmentInput=>({
 expectedOwnerId:'athlete-A',authenticatedOwnerId:'athlete-A',accessGateReady:true,
 watchOwnerId:'athlete-A',watchInstanceId:'session-1',watchKnownSessionVersion:4,
 permission:'granted',connectedToCanonicalWriter:true,
 session:{instanceId:'session-1',ownerId:'athlete-A',revisionSessionId:'planned-1',status:'active',version:5},
});

test('attaches to the one verified Training instance, never creates a second workout',()=>{
 assert.deepEqual(resolveWatchSessionAttachment(fixture()),{
  kind:'attach',instanceId:'session-1',sessionVersion:5,revisionSessionId:'planned-1',
  state:'active',noNewWorkout:true,noCanonicalWrite:true,
 });
 for(const status of ['paused','finishing'] as const){
  const input=fixture();input.session={...input.session!,status};
  const result=resolveWatchSessionAttachment(input);
  assert.equal(result.kind,'attach');
  if(result.kind==='attach')assert.equal(result.state,status);
 }
});
test('sign out, account switch, watch ownership mismatch, or access gate loss block',()=>{
 for(const patch of [
  {authenticatedOwnerId:null},{authenticatedOwnerId:'athlete-B'},
  {watchOwnerId:'athlete-B'},{watchOwnerId:null},{accessGateReady:false},
 ]){
  assert.equal(resolveWatchSessionAttachment({...fixture(),...patch}).kind,'blocked');
 }
});
test('permission denied, restricted, undecided, and missing all fail closed',()=>{
 for(const permission of ['denied','restricted','not_determined','unavailable'] as const)
  assert.deepEqual(resolveWatchSessionAttachment({...fixture(),permission}),{
    kind:'blocked',reason:'watch_permission_not_granted',noNewWorkout:true,noCanonicalWrite:true,
  });
});
test('offline or unverified session requires reconciliation, never a new start',()=>{
 for(const patch of [{connectedToCanonicalWriter:false},{session:undefined}]){
  const result=resolveWatchSessionAttachment({...fixture(),...patch});
  assert.equal(result.kind,'reconcile');assert.equal(result.noNewWorkout,true);
 }
});
test('no session and terminal sessions do not produce a Watch workout',()=>{
 assert.equal(resolveWatchSessionAttachment({...fixture(),session:null}).kind,'blocked');
 for(const status of ['completed','cancelled','abandoned','skipped'] as const){
  const input=fixture();input.session={...input.session!,status};
  assert.equal(resolveWatchSessionAttachment(input).kind,'blocked');
 }
});
test('session mismatch and Watch future/stale-invalid version require reconciliation',()=>{
 for(const patch of [
  {watchInstanceId:'another-instance'},
  {watchKnownSessionVersion:6},
  {watchKnownSessionVersion:1.5},
 ]){
  const result=resolveWatchSessionAttachment({...fixture(),...patch});
  assert.equal(result.kind,'reconcile');assert.equal(result.noCanonicalWrite,true);
 }
});
test('malformed session and wrong owner block attachment',()=>{
 const base=fixture();
 for(const patch of [
  {instanceId:''},{ownerId:'athlete-B'},{version:-1},{version:2.5},{revisionSessionId:''},
 ]){
  const result=resolveWatchSessionAttachment({...base,session:{...base.session!,...patch}});
  assert.equal(result.kind,'blocked');
 }
});
test('unplanned session and older Watch snapshot retain same canonical identity',()=>{
 const input=fixture();input.session={...input.session!,revisionSessionId:null};
 input.watchInstanceId=null;input.watchKnownSessionVersion=null;
 const result=resolveWatchSessionAttachment(input);
 assert.equal(result.kind,'attach');
 if(result.kind==='attach')assert.equal(result.revisionSessionId,null);
});
