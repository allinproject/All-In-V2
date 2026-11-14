// Synthetic contract tests ONLY; no provider HTTP or database concurrency.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateResumableOperationBoundary} from
 '../supabase/functions/_shared/trainingPrivateResumableOperationBoundary.mjs';

const a='4eac09be-9845-48db-9348-474e5c08e6e8';
const b='ace795cc-95d6-45f4-9017-73e7e29d7fd1';
const sid='b6b386b7-a705-44f3-927e-1c81c60391c6';
const authSid='68d3fdec-9050-4252-99ac-72e932119db2';
const leaseId='4a5c3ccc-ed0a-40fa-8e77-8324c992956e';
const bucket='v2-private-workout-objects';
const path=a+'/upload.bin',now=1700000000000;
const request=(action='PATCH')=>({
 action,verifiedOwnerId:a,bucketId:bucket,path,sessionId:sid,
 ...(action==='PATCH'?{offset:10,chunkBytes:5}:{}),
});
const state=()=>({
 verifiedIdentity:{ownerId:a,authSessionId:authSid,currentSession:true,revoked:false},
 session:{id:sid,ownerId:a,authSessionId:authSid,bucketId:bucket,path,
  state:'active',leaseId,expiresAtMs:now+100000,totalBytes:20,
  offset:10,providerUrlExposed:false},
 lease:{id:leaseId,ownerId:a,bucketId:bucket,path,operation:'create',
  signedAttested:true,cancelledAt:null,settledAt:null,expiresAtMs:now+100000},
 ownerState:{ownerId:a,deletionLocked:false,disabled:false},
});
const setup=({current=state(),perform=async()=>({verified:true,offset:15})}={})=>{
 const calls=[];
 const boundary=createPrivateResumableOperationBoundary({
  providerIngressRestricted:true,exclusiveCommitFenceProven:true,
  clock:()=>now,readLockedState:async()=>{calls.push('read');return current;},
  withCanonicalOwnerFence:async(owner,fn)=>{calls.push('lock');assert.equal(owner,a);
   try{return await fn();}finally{calls.push('unlock');}},
  performWithinFence:async(args)=>{calls.push('provider');return perform(args);},
 });
 return {boundary,calls};
};
test('cannot construct without both proof gates and authoritative dependencies',()=>{
 const args={withCanonicalOwnerFence:async()=>{},readLockedState:async()=>{},
  performWithinFence:async()=>{},clock:()=>now};
 assert.throws(()=>createPrivateResumableOperationBoundary(args),
   /private_resumable_operation_unverified/);
 assert.throws(()=>createPrivateResumableOperationBoundary({
  ...args,providerIngressRestricted:true}),
  /private_resumable_operation_unverified/);
});
test('PATCH rechecks inside owner lock and holds lock until provider acknowledges exact offset',async()=>{
 const {boundary,calls}=setup();
 const r=await boundary.execute(request());
 assert.deepEqual(r,{status:'chunk_verified',offset:15});
 assert.deepEqual(calls,['lock','read','provider','unlock']);
});
test('cancellation/deletion lock or expired lease cannot reach provider',async()=>{
 for(const current of [
  {...state(),ownerState:{...state().ownerState,deletionLocked:true}},
  {...state(),lease:{...state().lease,cancelledAt:now-1}},
  {...state(),lease:{...state().lease,expiresAtMs:now}},
  {...state(),session:{...state().session,state:'cancelled'}},
  {...state(),verifiedIdentity:{...state().verifiedIdentity,ownerId:b}},
 ]){
  const {boundary,calls}=setup({current});
  await assert.rejects(boundary.execute(request()),/not_authorized|unverified/);
  assert.deepEqual(calls,['lock','read','unlock']);
 }
});
test('caller-supplied fake state ignored and request owner must match',async()=>{
 const {boundary,calls}=setup();
 await assert.rejects(boundary.execute({...request(),verifiedOwnerId:b}));
 assert(!calls.includes('provider'));
});
test('ambiguous PATCH outcome never returns a success receipt',async()=>{
 for(const proof of [null,{verified:false,offset:15},{verified:true,offset:14}]){
  const {boundary,calls}=setup({perform:async()=>proof});
  await assert.rejects(boundary.execute(request()),/private_resumable_operation_unverified/);
  assert.deepEqual(calls,['lock','read','provider','unlock']);
 }
});
test('CANCEL requires independent provider invalidation, absent bytes and canonical cancel',async()=>{
 for(const proof of [{canonicalLeaseCancelled:true},{providerSessionInvalidated:true,
  canonicalLeaseCancelled:true},{providerSessionInvalidated:true,
  providerByteAbsenceVerified:true}]){
  const {boundary}=setup({perform:async()=>proof});
  await assert.rejects(boundary.execute(request('CANCEL')),/private_resumable_operation_unverified/);
 }
 const {boundary}=setup({perform:async()=>({providerSessionInvalidated:true,
  providerByteAbsenceVerified:true,canonicalLeaseCancelled:true})});
 assert.deepEqual(await boundary.execute(request('CANCEL')),{status:'cancel_verified'});
});
test('FINALIZE cannot settle incomplete upload or without exact bytes and signed receipt',async()=>{
 const {boundary,calls}=setup({perform:async()=>({
  providerExactSha256Verified:true,canonicalSignedLeaseSettled:true})});
 await assert.rejects(boundary.execute(request('FINALIZE')),
  /private_resumable_not_authorized/);
 assert(!calls.includes('provider'));
 const full=state();full.session.offset=full.session.totalBytes;
 const {boundary:finished}=setup({current:full,perform:async()=>({
  providerExactSha256Verified:true,canonicalSignedLeaseSettled:true})});
 assert.deepEqual(await finished.execute(request('FINALIZE')),
  {status:'finalized_verified'});
});
