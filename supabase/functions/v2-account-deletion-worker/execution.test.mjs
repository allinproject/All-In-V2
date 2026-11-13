import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeDeletionOnce } from './execution.ts';
const request = { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251', request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0251' };
function fixture(changes = {}) {
  const calls = [];
  const services = {
    claim: async () => ({data: {status:'processing', ...request}}),
    verifyStorageReadiness: async () => ({ownerId:request.user_id,
      requestId:request.request_id,completePrivateStorage:true,
      uploadBarrierEnforced:true,durableCheckpointVerified:true}),
    deleteAuthUser: async () => ({}),
    inspectAuthUser: async () => ({error:{status:404,code:'user_not_found'}}),
    complete: async () => ({data:{status:'completed',request_id:request.request_id}}),
    verifyCompletion: async () => ({data:{status:'not_completed',request_id:request.request_id}}),
    recordFailure: async () => ({}),
    ...changes,
  };
  const wrapped = Object.fromEntries(Object.entries(services).map(([k,fn]) => [k, async (...args) => { calls.push([k,...args]); return fn(...args); }]));
  return {services:wrapped,calls};
}
test('valid claim deletes exactly once then records completion', async () => {
  const {services,calls} = fixture();
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.deepEqual(calls.map(c=>c[0]),['claim','verifyStorageReadiness','deleteAuthUser','inspectAuthUser','complete']);
});
test('never deletes for failed, thrown or mismatched claims', async () => {
  const bad = [async()=>{throw Error('network')},async()=>({error:{code:'blocked'}}),async()=>({data:{status:'processing',user_id:request.user_id,request_id:'different'}}),async()=>({data:{status:'cancelled',...request}})];
  for (const claim of bad) {
    const {services,calls}=fixture({claim});
    assert.equal(await executeDeletionOnce(request,services),'claim_not_accepted');
    assert.deepEqual(calls.map(c=>c[0]),['claim']);
  }
});
test('ambiguous deletion never retries: when Auth still exists, records failure', async () => {
  const {services,calls}=fixture({
    deleteAuthUser:async()=>{throw Error('socket closed')},
    inspectAuthUser:async()=>({data:{id:request.user_id}}),
  });
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.deepEqual(calls.map(c=>c[0]),['claim','verifyStorageReadiness','deleteAuthUser','inspectAuthUser','recordFailure']);
  assert.equal(calls[4][2],'auth_verify_failed');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});
test('ambiguous delete transport failure with independently verified absence completes without retry', async () => {
  const {services,calls}=fixture({deleteAuthUser:async()=>{throw Error('socket closed')}});
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.deepEqual(calls.map(c=>c[0]),['claim','verifyStorageReadiness','deleteAuthUser','inspectAuthUser','complete']);
});
test('error response from delete API with verified Auth absence also completes once', async () => {
  const {services,calls}=fixture({deleteAuthUser:async()=>({error:{status:503,code:'gateway_timeout'}})});
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});
test('an unknown 404 is not treated as verified Auth absence', async () => {
  const {services,calls}=fixture({inspectAuthUser:async()=>({error:{status:404,code:'upstream_unavailable'}})});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.deepEqual(calls.map(c=>c[0]),['claim','verifyStorageReadiness','deleteAuthUser','inspectAuthUser','recordFailure']);
  assert.equal(calls[4][2],'auth_verify_failed');
});
test('an Auth user still found cannot complete deletion', async () => {
  const {services,calls}=fixture({inspectAuthUser:async()=>({data:{id:request.user_id}})});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.some(c=>c[0]==='complete'),false);
});
test('completion database error requires manual recovery, not another delete', async () => {
  const {services,calls}=fixture({complete:async()=>({error:{code:'db_failed'}})});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
  assert.equal(calls.at(-1)[2],'completion_failed');
});
test('a malformed completion receipt is not success', async () => {
  const {services,calls}=fixture({complete:async()=>({data:{status:'completed',request_id:'wrong'}})});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.at(-1)[0],'recordFailure');
});
test('failure-recording error still returns manual recovery', async () => {
  const {services,calls}=fixture({
    deleteAuthUser:async()=>({error:{status:500}}),
    inspectAuthUser:async()=>({data:{id:request.user_id}}),
    recordFailure:async()=>{throw Error('db down')},
  });
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});
test('failed read-only Auth verification must never mark completion', async () => {
  const {services,calls}=fixture({inspectAuthUser:async()=>{throw Error('auth read timeout')}});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.some(c=>c[0]==='complete'),false);
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});
test('completion network ambiguity cannot trigger a second delete', async () => {
  const {services,calls}=fixture({complete:async()=>{throw Error('db unavailable')}});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});

test('lost completion response is recovered through read-only durable audit', async () => {
  const {services,calls} = fixture({
    complete: async () => { throw Error('completion receipt response lost'); },
    verifyCompletion: async () => ({data:{status:'completed',request_id:request.request_id}}),
  });
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.deepEqual(calls.map(x=>x[0]),['claim','verifyStorageReadiness','deleteAuthUser','inspectAuthUser','complete','verifyCompletion']);
  assert.equal(calls.filter(x=>x[0]==='deleteAuthUser').length,1);
});
test('wrong request ID in read-only audit cannot assert completion', async () => {
  const {services,calls}=fixture({
    complete: async () => ({error:{code:'timeout'}}),
    verifyCompletion: async () => ({data:{status:'completed',request_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'}}),
  });
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.at(-1)[0],'recordFailure');
});
test('audit readback failure cannot trigger retrying destructive operations', async () => {
  const {services,calls}=fixture({
    complete: async () => { throw Error('lost receipt'); },
    verifyCompletion: async () => { throw Error('audit read failed'); },
  });
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.equal(calls.filter(x=>x[0]==='deleteAuthUser').length,1);
  assert.equal(calls.filter(x=>x[0]==='complete').length,1);
});

test('Storage proof is mandatory; no Auth deletion on missing, false or stale evidence',async()=>{
 for(const proof of [
  null,false,true,{}, {ownerId:request.user_id,requestId:'wrong',
   completePrivateStorage:true,uploadBarrierEnforced:true,durableCheckpointVerified:true},
  {ownerId:request.user_id,requestId:request.request_id,
   completePrivateStorage:true,uploadBarrierEnforced:false,durableCheckpointVerified:true},
  {ownerId:request.user_id,requestId:request.request_id,
   completePrivateStorage:true,uploadBarrierEnforced:true,durableCheckpointVerified:false},
 ]) {
  const {services,calls}=fixture({verifyStorageReadiness:async()=>proof});
  assert.equal(await executeDeletionOnce(request,services),'storage_not_accepted');
  assert.deepEqual(calls.map(c=>c[0]),['claim','verifyStorageReadiness']);
 }
});
test('missing or throwing Storage readiness service remains fail closed',async()=>{
 const absent=fixture();
 delete absent.services.verifyStorageReadiness;
 assert.equal(await executeDeletionOnce(request,absent.services),'storage_not_accepted');
 assert.deepEqual(absent.calls.map(c=>c[0]),['claim']);
 const failed=fixture({verifyStorageReadiness:async()=>{throw Error('DB unavailable')}});
 assert.equal(await executeDeletionOnce(request,failed.services),'storage_not_accepted');
 assert.equal(failed.calls.some(c=>c[0]==='deleteAuthUser'),false);
});
