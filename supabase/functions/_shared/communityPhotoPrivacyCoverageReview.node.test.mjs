import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditCommunityPhotoCoverageReview as audit,
 auditCommunityPhotoDeletionAbsenceReview as deletion,
 auditCommunityPhotoDeletionPlanReview as planReview,
 REVIEW_COMMUNITY_PHOTO_BUCKET as bucket} from './communityPhotoPrivacyCoverageReview.mjs';
const a='a1111111-a111-4111-8111-a11111111111';
const b='b2222222-b222-4222-8222-b22222222222';
const request='c3333333-c333-4333-8333-c33333333333';
const post='d4444444-d444-4444-8444-d44444444444';
const id='e5555555-e555-4555-8555-e55555555555';
const path=a+'/posts/'+post+'/'+id+'.png';
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const hash=createHash('sha256').update(bytes).digest('hex');
const row={id,post_id:post,owner_id:a,post_owner_id:a,bucket_id:bucket,
 object_path:path,post_version:1,content_type:'image/png',width:2,height:2,
 byte_length:bytes.length,sha256:hash,lifecycle:'verified',verified_at:'2026-11-14T00:00:00Z'};
function fixture(change={}){
 const calls=[];
 const config={ownerId:a,requestId:request,
  listBucketCatalog:async()=>{calls.push('catalog');return change.catalog??[{id:bucket,public:false}];},
  listCanonicalPostPhotos:async()=>{calls.push('rows');return change.snapshot??{ownerId:a,complete:true,rows:change.rows??[row]};},
  listOwnerStorageObjects:async()=>{calls.push('inventory');return change.inventory??{ownerId:a,bucketId:bucket,exhaustive:true,totalCount:1,paths:[path]};},
  downloadPrivatePhoto:async()=>{calls.push('bytes');return change.bytes??bytes;},
 };
 return {config,calls};
}
test('exact canonical owner/post/bytes audit stays review only',async()=>{
 const f=fixture();const r=await audit(f.config);
 assert.equal(r.photosVerified,1);
 assert.equal(r.completeUserExport,false);
 assert.equal(r.accountDeletionReady,false);
 assert.deepEqual(f.calls,['catalog','rows','inventory','bytes']);
});
test('foreign owner, changed post, unverified lifecycle and forged key fail before download',async()=>{
 for(const override of [{owner_id:b},{post_owner_id:b},{post_id:b},{object_path:b+'/other'},
  {lifecycle:'pending',verified_at:null},{sha256:'wrong'},{content_type:'video/mp4'},
  {byte_length:9*1024*1024}]){
  const f=fixture({rows:[{...row,...override}]});
  await assert.rejects(audit(f.config));
  assert.equal(f.calls.includes('bytes'),false);
 }
});
test('missing, extra and incomplete Storage inventory are rejected',async()=>{
 for(const inventory of [
  {ownerId:a,bucketId:bucket,exhaustive:false,totalCount:1,paths:[path]},
  {ownerId:a,bucketId:bucket,exhaustive:true,totalCount:0,paths:[]},
  {ownerId:a,bucketId:bucket,exhaustive:true,totalCount:2,paths:[path,b+'/foreign.png']},
  {ownerId:b,bucketId:bucket,exhaustive:true,totalCount:1,paths:[path]},
 ]){
  const f=fixture({inventory});
  await assert.rejects(audit(f.config),/inventory/);
  assert.equal(f.calls.includes('bytes'),false);
 }
});
test('changed bytes, truncated canonical snapshot and public bucket fail closed',async()=>{
 const corrupted=new Uint8Array(bytes);corrupted[0]^=1;
 for(const change of [
  {bytes:corrupted},{snapshot:{ownerId:a,complete:false,rows:[row]}},
  {catalog:[{id:bucket,public:true}]},
 ]){
  await assert.rejects(audit(fixture(change).config));
 }
});
test('real legacy deletion verifier requires complete scoped immutable plan and barrier',async()=>{
 const calls=[];
 const args={ownerId:a,requestId:request,approvedBucketIds:[bucket],
  listBucketCatalog:async()=>[{id:bucket,public:false}],
  assertOwnerWritesQuiesced:async()=>true,
  readExistingObjectPlan:async()=>({ownerId:a,requestId:request,bucketId:bucket,durable:true,paths:[path]}),
  verifyBucketCheckpoints:async()=>true,
  objectExists:async()=>{calls.push('exists');return false;},
  objectBytesAbsent:async()=>{calls.push('byte-absent');return true;},
  listOwnerStorageObjects:async()=>({ownerId:a,bucketId:bucket,exhaustive:true,totalCount:0,paths:[]}),
 };
 const result=await deletion(args);
 assert.equal(result.accountDeletionReady,false);
 assert.equal(result.completePrivateStorage,false);
 assert.equal(result.uploadBarrierEnforced,false);
 assert.deepEqual(calls,['exists','byte-absent']);
 await assert.rejects(deletion({...args,approvedBucketIds:[]}),/absent from exact deletion scope/);
 await assert.rejects(deletion({...args,assertOwnerWritesQuiesced:async()=>false}),/barrier/);
 await assert.rejects(deletion({...args,objectBytesAbsent:async()=>false}),/bytes remain/);
});

test('canonical photo deletion plan reconciles exact owner records before byte proof',async()=>{
 const steps=[];
 const input={ownerId:a,requestId:request,
  listCanonicalPostPhotos:async()=>{steps.push('canonical');return {ownerId:a,complete:true,rows:[row]};},
  readExistingObjectPlan:async()=>{steps.push('plan');return {
   ownerId:a,requestId:request,bucketId:bucket,durable:true,paths:[path],
  };},
  approvedBucketIds:[bucket],
  listBucketCatalog:async()=>[{id:bucket,public:false}],
  assertOwnerWritesQuiesced:async()=>true,
  verifyBucketCheckpoints:async()=>true,
  objectExists:async()=>{steps.push('exists');return false;},
  objectBytesAbsent:async()=>{steps.push('bytes');return true;},
  listOwnerStorageObjects:async()=>({ownerId:a,bucketId:bucket,exhaustive:true,totalCount:0,paths:[]}),
 };
 const proof=await planReview(input);
 assert.equal(proof.canonicalPlanReconciled,true);
 assert.equal(proof.canonicalPhotoCount,1);
 assert.equal(proof.accountDeletionReady,false);
 assert.equal(proof.uploadBarrierEnforced,false);
 assert.deepEqual(steps,['canonical','plan','plan','exists','bytes']);
 for(const paths of [[],[b+'/other.png'],[path,path]]){
  steps.length=0;
  await assert.rejects(planReview({...input,readExistingObjectPlan:async()=>{
   steps.push('plan');return {ownerId:a,requestId:request,bucketId:bucket,durable:true,paths};
  }}),/diverged/);
  assert.deepEqual(steps,['canonical','plan']);
 }
 await assert.rejects(planReview({...input,listCanonicalPostPhotos:async()=>({
  ownerId:a,complete:false,rows:[row],
 })}),/Incomplete canonical/);
});
