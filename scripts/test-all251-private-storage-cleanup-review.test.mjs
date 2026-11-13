import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewPrivateStorageCleanup} from '../supabase/functions/_shared/trainingDeletionPrivateStorageReview.mjs';

const A='a1111111-a111-4111-8111-a11111111111';
const B='b2222222-b222-4222-8222-b22222222222';
const R='c3333333-c333-4333-8333-c33333333333';
const bucketId='v2-private-workout-objects';
function fixture() {
 const objects=new Set([A+'/one.fit',A+'/nested/two.fit',B+'/leave-me.fit']);
 const checkpoints=[];
 let failOnce=false;
 return {
  objects,checkpoints,
  setFailOnce:()=>{failOnce=true;},
  opts:{
   ownerId:A,requestId:R,approvedBucketIds:[bucketId],
   listBucketCatalog:async()=>[{id:bucketId,public:false}],
   listOwnerStorageObjects:async({ownerId,requestId,bucketId:bucket})=>{
    assert.equal(ownerId,A);assert.equal(requestId,R);assert.equal(bucket,bucketId);
    const paths=[...objects].filter(x=>x.startsWith(ownerId+'/'));
    return {ownerId,bucketId:bucket,exhaustive:true,totalCount:paths.length,paths};
   },
   objectExists:async({path})=>objects.has(path),
   deleteObject:async({path})=>{
    if(failOnce){failOnce=false;throw Error('temporary Storage 503');}
    objects.delete(path);return {deleted:true};
   },
   recordCheckpoint:async(entry)=>{checkpoints.push(entry);},
   assertOwnerWritesQuiesced:async({ownerId,requestId})=>ownerId===A&&requestId===R,
  },
 };
}
test('ALL-251 review removes only A, verifies absence and repeats idempotently',async()=>{
 const f=fixture();
 const first=await reviewPrivateStorageCleanup(f.opts);
 assert.equal(first.verifiedAbsent,2);
 assert.equal(first.reviewOnly,true);
 assert.deepEqual([...f.objects],[B+'/leave-me.fit']);
 assert.equal(f.checkpoints.length,2);
 const again=await reviewPrivateStorageCleanup(f.opts);
 assert.equal(again.verifiedAbsent,0);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
});
test('transient failure refuses completion; rerun resumes without touching B',async()=>{
 const f=fixture();f.setFailOnce();
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/temporary Storage 503/);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
 const result=await reviewPrivateStorageCleanup(f.opts);
 assert.equal(result.verifiedAbsent,2);
 assert.equal(f.objects.size,1);
});
test('foreign path, incomplete listing and unreviewed bucket fail closed',async()=>{
 const f=fixture(),original=f.opts.listOwnerStorageObjects;
 f.opts.listOwnerStorageObjects=async p=>({...await original(p),paths:[B+'/leave-me.fit'],totalCount:1});
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/Foreign/);
 f.opts.listOwnerStorageObjects=async p=>({...await original(p),exhaustive:false});
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/Incomplete/);
 f.opts.listOwnerStorageObjects=original;
 f.opts.listBucketCatalog=async()=>[{id:bucketId,public:false},{id:'unreviewed-private',public:false}];
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/Unreviewed/);
});
test('failure to verify object absence fails without checkpoint',async()=>{
 const f=fixture();
 f.opts.deleteObject=async()=>({deleted:true});
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/still exists/);
 assert.equal(f.checkpoints.length,0);
});
test('invalid owner and missing durable checkpoint dependency fail',async()=>{
 const f=fixture();f.opts.ownerId='not-a-uuid';
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/dependencies required/);
 delete f.opts.recordCheckpoint;
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/dependencies required/);
});

test('write barrier missing, false or expired blocks acceptance',async()=>{
 const absent=fixture();
 delete absent.opts.assertOwnerWritesQuiesced;
 await assert.rejects(reviewPrivateStorageCleanup(absent.opts),/dependencies required/);
 assert.equal(absent.objects.size,3);
 const denied=fixture();
 denied.opts.assertOwnerWritesQuiesced=async()=>false;
 await assert.rejects(reviewPrivateStorageCleanup(denied.opts),/not authoritatively quiesced/);
 assert.equal(denied.objects.size,3);
 const expires=fixture();
 let calls=0;
 expires.opts.assertOwnerWritesQuiesced=async()=>++calls<3;
 await assert.rejects(reviewPrivateStorageCleanup(expires.opts),/barrier expired/);
 assert.equal(expires.objects.has(B+'/leave-me.fit'),true);
});
test('bucket catalog changes before final release fails closed',async()=>{
 const f=fixture();let count=0;
 f.opts.listBucketCatalog=async()=>++count===1?
  [{id:bucketId,public:false}]:
  [{id:bucketId,public:false},{id:'unexpected-private',public:false}];
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/catalog changed/);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
});

test('late owner upload is detected by final inventory even with stale barrier assertion',async()=>{
 const f=fixture();
 const record=f.opts.recordCheckpoint;
 let introduced=false;
 f.opts.recordCheckpoint=async entry=>{
  await record(entry);
  if(!introduced){
   introduced=true;
   f.objects.add(A+'/late-upload.fit');
  }
 };
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/inventory not empty/);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
 assert.equal(f.objects.has(A+'/late-upload.fit'),true);
 // Test demonstrates a listing guard, NOT a real upload freeze.
});
