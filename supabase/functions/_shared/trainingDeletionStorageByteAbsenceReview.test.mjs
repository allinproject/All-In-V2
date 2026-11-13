import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPrivateStorageByteAbsenceReview} from './trainingDeletionStorageByteAbsenceReview.mjs';
const A='a1111111-a111-4111-8111-a11111111111',B='b2222222-b222-4222-8222-b22222222222';
const R='c3333333-c333-4333-8333-c33333333333';
const bucket='v2-private-workout-objects';
function fixture(){
 let exists=false;
 const paths=[A+'/one.fit',A+'/nested/two.fit'];
 const state={
  ownerId:A,requestId:R,approvedBucketIds:[bucket],
  listBucketCatalog:async()=>[{id:bucket,public:false}],
  readExistingObjectPlan:async({ownerId,requestId,bucketId})=>({
   ownerId,requestId,bucketId,paths,durable:true}),
  listOwnerStorageObjects:async({ownerId,bucketId})=>({
   ownerId,bucketId,exhaustive:true,totalCount:exists?1:0,
   paths:exists?[A+'/late.fit']:[]}),
  objectExists:async()=>false,
  verifyBucketCheckpoints:async()=>true,
  assertOwnerWritesQuiesced:async()=>true,
 };
 return {state,setExists:v=>exists=v};
}
test('exact canonical plans and Storage API absence are required',async()=>{
 const f=fixture();
 const out=await verifyPrivateStorageByteAbsenceReview(f.state);
 assert.equal(out.storageApiAbsenceVerified,true);
 assert.equal(out.reviewOnly,true);
 assert.equal(out.plannedObjectCount,2);
 assert.equal(out.uploadBarrierEnforced,undefined);
});
test('late upload, unverified existence, stale barrier, unplanned bucket all deny',async()=>{
 const cases=[
  s=>{s.listOwnerStorageObjects=async()=>({ownerId:A,bucketId:bucket,
   exhaustive:true,totalCount:1,paths:[A+'/late.fit']});},
  s=>{s.objectExists=async()=>true;},
  s=>{s.objectExists=async()=>null;},
  s=>{s.assertOwnerWritesQuiesced=async()=>false;},
  s=>{s.verifyBucketCheckpoints=async()=>false;},
  s=>{s.listBucketCatalog=async()=>[{id:bucket,public:true}];},
  s=>{s.readExistingObjectPlan=async()=>({ownerId:A,requestId:R,bucketId:bucket,
   durable:true,paths:[B+'/foreign.fit']});},
 ];
 for(const change of cases){
  const f=fixture();change(f.state);
  await assert.rejects(verifyPrivateStorageByteAbsenceReview(f.state));
 }
});
test('read-only source cannot create new manifest and must be supplied',async()=>{
 const f=fixture();delete f.state.readExistingObjectPlan;
 await assert.rejects(verifyPrivateStorageByteAbsenceReview(f.state),/dependencies required/);
});
