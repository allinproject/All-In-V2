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
 const plans=new Map();
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
   recordCheckpoint:async(entry)=>{
    const index=checkpoints.findIndex(x=>x.ownerId===entry.ownerId&&
     x.requestId===entry.requestId&&x.bucketId===entry.bucketId&&x.path===entry.path);
    if(index<0)checkpoints.push(entry);else checkpoints[index]=entry;
    return {persisted:true};
   },
   persistAndLoadObjectPlan:async({ownerId,requestId,bucketId,observedPaths})=>{
    const id=ownerId+':'+requestId+':'+bucketId;
    if(!plans.has(id))plans.set(id,[...observedPaths]);
    return {ownerId,requestId,bucketId,durable:true,paths:[...plans.get(id)]};
   },
   readCheckpoint:async({ownerId,requestId,bucketId,path})=>checkpoints.find(c=>
    c.ownerId===ownerId&&c.requestId===requestId&&c.bucketId===bucketId&&c.path===path),
   assertOwnerWritesQuiesced:async({ownerId,requestId})=>ownerId===A&&requestId===R,
   verifyBucketCheckpoints:async({ownerId,requestId,bucketId,plannedCount})=>
    checkpoints.filter(c=>c.ownerId===ownerId&&c.requestId===requestId&&
     c.bucketId===bucketId&&c.state==='absent_verified').length===plannedCount,
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
 assert.equal(again.verifiedAbsent,2);
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
  const saved=await record(entry);
  if(!introduced){
   introduced=true;
   f.objects.add(A+'/late-upload.fit');
  }
  return saved;
 };
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/inventory not empty/);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
 assert.equal(f.objects.has(A+'/late-upload.fit'),true);
 // Test demonstrates a listing guard, NOT a real upload freeze.
});

test('unacknowledged or mismatched checkpoint readback refuses success',async()=>{
 const absent=fixture();
 absent.opts.recordCheckpoint=async()=>({persisted:false});
 await assert.rejects(reviewPrivateStorageCleanup(absent.opts),/not persisted/);
 const wrong=fixture();
 wrong.opts.readCheckpoint=async()=>({...wrong.checkpoints[0],ownerId:B});
 await assert.rejects(reviewPrivateStorageCleanup(wrong.opts),/readback not verified/);
 assert.equal(wrong.objects.has(B+'/leave-me.fit'),true);
});

test('crash after deletion before checkpoint retains plan and reconciles on retry',async()=>{
 const f=fixture();let crashed=false;
 const original=f.opts.recordCheckpoint;
 f.opts.recordCheckpoint=async entry=>{
  if(!crashed){crashed=true;throw Error('checkpoint DB unavailable');}
  return original(entry);
 };
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/checkpoint DB unavailable/);
 assert.equal([...f.objects].filter(path=>path.startsWith(A+'/')).length,1,
  'Exactly one owner object must already be deleted before checkpoint failure');
 const result=await reviewPrivateStorageCleanup(f.opts);
 assert.equal(result.verifiedAbsent,2);
 assert.equal(f.checkpoints.length,2);
 assert.deepEqual([...f.objects],[B+'/leave-me.fit']);
});
test('missing, wrong-owner and stale immutable plan never authorize completion',async()=>{
 const f=fixture();
 delete f.opts.persistAndLoadObjectPlan;
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/dependencies required/);
 const wrong=fixture();
 wrong.opts.persistAndLoadObjectPlan=async()=>({
  ownerId:B,requestId:R,bucketId,durable:true,paths:[A+'/one.fit']});
 await assert.rejects(reviewPrivateStorageCleanup(wrong.opts),/Durable Storage object plan unavailable/);
 const missing=fixture();
 missing.opts.persistAndLoadObjectPlan=async()=>({
  ownerId:A,requestId:R,bucketId,durable:true,paths:[A+'/one.fit']});
 await assert.rejects(reviewPrivateStorageCleanup(missing.opts),/Unplanned owner Storage object/);
 assert.equal(missing.objects.size,3);
});

test('barrier loss before object delete blocks destructive call',async()=>{
 const f=fixture();let checks=0,deletes=0;
 f.opts.assertOwnerWritesQuiesced=async()=>++checks<3;
 f.opts.deleteObject=async()=>{deletes++;return {deleted:true};};
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/expired before object cleanup/);
 assert.equal(deletes,0);
 assert.equal(f.objects.size,3);
});
test('barrier loss before checkpoint refuses false success',async()=>{
 const f=fixture();let checks=0;
 f.opts.assertOwnerWritesQuiesced=async()=>++checks<4;
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/expired before checkpoint/);
 assert.equal(f.checkpoints.length,0);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
});

test('incomplete database-wide checkpoint coverage blocks receipt',async()=>{
 const f=fixture();
 f.opts.verifyBucketCheckpoints=async()=>false;
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/checkpoint coverage incomplete/);
 assert.equal(f.objects.has(B+'/leave-me.fit'),true);
 assert.equal(f.checkpoints.length,2);
});
test('missing checkpoint coverage verifier is not silently skipped',async()=>{
 const f=fixture();
 delete f.opts.verifyBucketCheckpoints;
 await assert.rejects(reviewPrivateStorageCleanup(f.opts),/dependencies required/);
 assert.equal(f.objects.size,3);
});
