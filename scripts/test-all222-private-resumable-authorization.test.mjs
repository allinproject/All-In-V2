// ALL-222 offline-only policy checks, with synthetic authoritative server facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizePrivateResumableOperation as check} from
 '../supabase/functions/_shared/trainingPrivateResumableAuthorization.mjs';

const a='4eac09be-9845-48db-9348-474e5c08e6e8';
const b='ace795cc-95d6-45f4-9017-73e7e29d7fd1';
const sid='b6b386b7-a705-44f3-927e-1c81c60391c6';
const authSid='68d3fdec-9050-4252-99ac-72e932119db2';
const leaseId='4a5c3ccc-ed0a-40fa-8e77-8324c992956e';
const bucket='v2-private-workout-objects';
const path=a+'/upload.bin';
const now=1700000000000;
function inputs(action='HEAD'){
 const session={id:sid,ownerId:a,authSessionId:authSid,
   bucketId:bucket,path,state:'active',leaseId,expiresAtMs:now+60000,
   totalBytes:6291457,offset:6291456,providerUrlExposed:false};
 return {action,requestedSessionId:sid,requestedBucket:bucket,requestedPath:path,
  verifiedIdentity:{ownerId:a,authSessionId:authSid,currentSession:true,revoked:false},
  session,lease:{id:leaseId,ownerId:a,bucketId:bucket,path,operation:'create',
    signedAttested:true,cancelledAt:null,settledAt:null,expiresAtMs:now+60000},
  ownerState:{ownerId:a,deletionLocked:false,disabled:false},nowMs:now,
  providerIngressRestricted:true,exclusiveCommitFenceProven:true};
}
const denied=(x)=>assert.throws(()=>check(x),/private_resumable_not_authorized/);
test('cannot activate without verified provider bypass restriction AND commit fence',()=>{
 const x=inputs();denied({...x,providerIngressRestricted:false});
 denied({...x,exclusiveCommitFenceProven:false});
 denied({...x,providerIngressRestricted:'true'});
});
test('owner can read status only with all current authoritative facts',()=>{
 const x=inputs();const result=check(x);
 assert.equal(result.verifiedOwnerId,a);
 assert.equal(result.expectedOffset,6291456);
 assert.equal('providerUrl' in result,false);
 assert.equal(Object.isFrozen(result),true);
});
test('foreign owner, foreign Auth session and foreign upload scope denied',()=>{
 const x=inputs();
 denied({...x,verifiedIdentity:{...x.verifiedIdentity,ownerId:b}});
 denied({...x,session:{...x.session,ownerId:b}});
 denied({...x,session:{...x.session,authSessionId:'32c194c8-194c-4d3a-9c0e-080e476f56ed'}});
 denied({...x,requestedSessionId:'ee3888a6-b9e1-469e-9d6a-ac04b1b0ebac'});
 denied({...x,requestedPath:b+'/upload.bin'});
 denied({...x,session:{...x.session,providerUrlExposed:true}});
});
test('revocation, deletion, cancellation, settlement and expiration deny all methods',()=>{
 for(const action of ['CREATE','HEAD','PATCH','FINALIZE','CANCEL']){
  const x=inputs(action);
  const opts=action==='PATCH'?{expectedOffset:6291456,chunkBytes:1}:{};
  const base={...x,...opts};
  denied({...base,verifiedIdentity:{...x.verifiedIdentity,currentSession:false}});
  denied({...base,verifiedIdentity:{...x.verifiedIdentity,revoked:true}});
  denied({...base,ownerState:{...x.ownerState,deletionLocked:true}});
  denied({...base,session:{...x.session,expiresAtMs:now}});
  denied({...base,session:{...x.session,state:'cancelled'}});
  denied({...base,lease:{...x.lease,cancelledAt:now-1}});
  denied({...base,lease:{...x.lease,settledAt:now-1}});
  denied({...base,lease:{...x.lease,expiresAtMs:now}});
 }
});
test('PATCH demands exact offset and bounded nonempty chunk',()=>{
 const x=inputs('PATCH');
 assert.equal(check({...x,expectedOffset:6291456,chunkBytes:1}).action,'PATCH');
 denied({...x,expectedOffset:6291455,chunkBytes:1});
 denied({...x,expectedOffset:6291456,chunkBytes:2});
 denied({...x,expectedOffset:6291456,chunkBytes:0});
 denied({...x,expectedOffset:6291456,chunkBytes:NaN});
});
test('FINALIZE only when all bytes are present; no chunk fields on HEAD',()=>{
 const x=inputs('FINALIZE');denied(x);
 assert.equal(check({...x,session:{...x.session,offset:x.session.totalBytes}}).action,'FINALIZE');
 denied({...inputs(),expectedOffset:0});
 denied({...inputs('DELETE')});
});
