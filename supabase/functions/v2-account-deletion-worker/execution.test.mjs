import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeDeletionOnce } from './execution.ts';
const request = { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251', request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0251' };
function fixture(changes = {}) {
  const calls = [];
  const services = {
    claim: async () => ({data: {status:'processing', ...request}}),
    deleteAuthUser: async () => ({}),
    inspectAuthUser: async () => ({error:{status:404,code:'user_not_found'}}),
    complete: async () => ({data:{status:'completed',request_id:request.request_id}}),
    recordFailure: async () => ({}),
    ...changes,
  };
  const wrapped = Object.fromEntries(Object.entries(services).map(([k,fn]) => [k, async (...args) => { calls.push([k,...args]); return fn(...args); }]));
  return {services:wrapped,calls};
}
test('valid claim deletes exactly once then records completion', async () => {
  const {services,calls} = fixture();
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.deepEqual(calls.map(c=>c[0]),['claim','deleteAuthUser','inspectAuthUser','complete']);
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
  assert.deepEqual(calls.map(c=>c[0]),['claim','deleteAuthUser','inspectAuthUser','recordFailure']);
  assert.equal(calls[3][2],'auth_verify_failed');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});
test('ambiguous delete transport failure with independently verified absence completes without retry', async () => {
  const {services,calls}=fixture({deleteAuthUser:async()=>{throw Error('socket closed')}});
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.deepEqual(calls.map(c=>c[0]),['claim','deleteAuthUser','inspectAuthUser','complete']);
});
test('error response from delete API with verified Auth absence also completes once', async () => {
  const {services,calls}=fixture({deleteAuthUser:async()=>({error:{status:503,code:'gateway_timeout'}})});
  assert.equal(await executeDeletionOnce(request,services),'completed');
  assert.equal(calls.filter(c=>c[0]==='deleteAuthUser').length,1);
});
test('an unknown 404 is not treated as verified Auth absence', async () => {
  const {services,calls}=fixture({inspectAuthUser:async()=>({error:{status:404,code:'upstream_unavailable'}})});
  assert.equal(await executeDeletionOnce(request,services),'manual_recovery_required');
  assert.deepEqual(calls.map(c=>c[0]),['claim','deleteAuthUser','inspectAuthUser','recordFailure']);
  assert.equal(calls[3][2],'auth_verify_failed');
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
