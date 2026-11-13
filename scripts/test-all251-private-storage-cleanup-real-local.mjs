/**
 * ALL-251 disposable LOCAL Supabase Storage API acceptance.
 * Synthetic owner folders only; fake write barrier is TEST-ONLY and this
 * cannot authorize account deletion or satisfy production gate.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createLocalDeletionStorageTransport} from '../supabase/functions/_shared/trainingDeletionLocalStorageTransport.mjs';
import {reviewPrivateStorageCleanup} from '../supabase/functions/_shared/trainingDeletionPrivateStorageReview.mjs';
import {verifyPrivateStorageByteAbsenceReview} from '../supabase/functions/_shared/trainingDeletionStorageByteAbsenceReview.mjs';

assert.equal(process.env.CI,'1','Disposable CI only');
const vars=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:15000,
}).split(/\r?\n/).map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/))
 .filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const endpoint=vars.API_URL;
const token=vars.SERVICE_ROLE_KEY;
const transport=createLocalDeletionStorageTransport({
 apiUrl:endpoint,serviceRoleKey:token,
});
const A='a1111111-a111-4111-8111-a11111111111';
const B='b2222222-b222-4222-8222-b22222222222';
const R='c3333333-c333-4333-8333-c33333333333';
const bucket='all251-cleanup-local-'+randomBytes(6).toString('hex');
const a1=A+'/sensor.fit',a2=A+'/nested/route.geojson',b1=B+'/preserve.fit';
const files=new Map([[a1,randomBytes(1091)],[a2,randomBytes(2118)],[b1,randomBytes(4097)]]);
const hash=b=>createHash('sha256').update(b).digest('hex');
const enc=p=>p.split('/').map(encodeURIComponent).join('/');
async function storage(method,path,body,contentType='application/json') {
 const headers={apikey:token,Authorization:'Bearer '+token};
 if(body!==undefined)headers['Content-Type']=contentType;
 return fetch(new URL(endpoint).origin+'/storage/v1'+path,{
  method,headers,body:body===undefined?undefined:contentType==='application/json'?
   JSON.stringify(body):body,
  signal:AbortSignal.timeout(15000),
 });
}
let created=false;
const checkpoints=[];
const durablePlanFixture=new Map();
try {
 const before=await transport.listBucketCatalog();
 assert(!before.some(b=>b.id===bucket),'Refuse to overwrite existing bucket');
 const createdResponse=await storage('POST','/bucket',{id:bucket,name:bucket,public:false});
 assert.ok(createdResponse.ok,'Create disposable private bucket');created=true;
 for(const [path,bytes] of files) {
  const uploaded=await storage('POST','/object/'+bucket+'/'+enc(path),
   bytes,'application/octet-stream');
  assert.ok(uploaded.ok,'Upload disposable private bytes');
 }
 const initial=await transport.listOwnerStorageObjects({ownerId:A,requestId:R,bucketId:bucket});
 assert.deepEqual(initial.paths.sort(),[a1,a2].sort(),'Owner inventory exact');
 assert.equal(await transport.objectExists({ownerId:A,requestId:R,bucketId:bucket,path:a1}),true);
 const bBefore=await storage('GET','/object/authenticated/'+bucket+'/'+enc(b1));
 assert.ok(bBefore.ok);
 assert.equal(hash(Buffer.from(await bBefore.arrayBuffer())),hash(files.get(b1)));
 const opts={
  ownerId:A,requestId:R,approvedBucketIds:[bucket],
  ...transport,
  recordCheckpoint:async row=>{
   const idx=checkpoints.findIndex(c=>c.path===row.path&&c.bucketId===row.bucketId);
   if(idx<0)checkpoints.push(row);else checkpoints[idx]=row;
   return {persisted:true};
  },
  // TEST-ONLY Map, not a durable DB plan or approved deletion implementation.
  persistAndLoadObjectPlan:async({ownerId,requestId,bucketId,observedPaths})=>{
   const id=ownerId+':'+requestId+':'+bucketId;
   if(!durablePlanFixture.has(id))durablePlanFixture.set(id,[...observedPaths]);
   return {ownerId,requestId,bucketId,durable:true,paths:[...durablePlanFixture.get(id)]};
  },
  // Local fixture readback, NOT proof of durable database persistence.
  readCheckpoint:async({ownerId,requestId,bucketId,path})=>checkpoints.find(row=>
   row.ownerId===ownerId&&row.requestId===requestId&&row.bucketId===bucketId&&row.path===path),
  // TEST-ONLY stub: no real Storage write barrier is claimed by this test.
  assertOwnerWritesQuiesced:async()=>true,
  // TEST-ONLY memory check, NOT durable Postgres proof.
  verifyBucketCheckpoints:async({ownerId,requestId,bucketId,plannedCount})=>
   checkpoints.filter(c=>c.ownerId===ownerId&&c.requestId===requestId&&
    c.bucketId===bucketId&&c.state==='absent_verified').length===plannedCount,
 };
 const first=await reviewPrivateStorageCleanup(opts);
 assert.equal(first.reviewOnly,true);
 assert.equal(first.verifiedAbsent,2);
 assert.equal(checkpoints.length,2);
 for(const path of [a1,a2])
  assert.equal(await transport.objectExists({ownerId:A,requestId:R,bucketId:bucket,path}),false);
 assert.equal((await transport.listOwnerStorageObjects({ownerId:A,requestId:R,bucketId:bucket})).totalCount,0);
 const absence=await verifyPrivateStorageByteAbsenceReview({
  ownerId:A,requestId:R,approvedBucketIds:[bucket],
  ...transport,
  readExistingObjectPlan:async({ownerId,requestId,bucketId})=>{
   const paths=durablePlanFixture.get(ownerId+':'+requestId+':'+bucketId);
   if(!paths)throw Error('Immutable plan missing');
   return {ownerId,requestId,bucketId,durable:true,paths:[...paths]};
  },
  verifyBucketCheckpoints:opts.verifyBucketCheckpoints,
  assertOwnerWritesQuiesced:opts.assertOwnerWritesQuiesced,
 });
 assert.equal(absence.storageApiAbsenceVerified,true);
 assert.equal(absence.plannedObjectCount,2);
 assert.equal(absence.reviewOnly,true);
 assert.equal(absence.uploadBarrierEnforced,undefined);
 const bAfter=await storage('GET','/object/authenticated/'+bucket+'/'+enc(b1));
 assert.ok(bAfter.ok,'Other owner object remains');
 assert.equal(hash(Buffer.from(await bAfter.arrayBuffer())),hash(files.get(b1)));
 const second=await reviewPrivateStorageCleanup(opts);
 assert.equal(second.verifiedAbsent,2,'Idempotent plan replay');
 assert.equal(checkpoints.length,2,'No duplicated checkpoints');
 const denied={...opts,assertOwnerWritesQuiesced:async()=>false};
 await assert.rejects(reviewPrivateStorageCleanup(denied),/not authoritatively quiesced/);
 console.log('PASS ALL-251: real local Storage REST scoped delete, nested inventory, same-owner absence, other-owner bytes, replay; simulated barrier only');
}finally{
 // Delete only this run's synthetic objects and bucket, never any preexisting bucket.
 if(created){
  for(const path of files.keys()) {
   // The scenario intentionally removed A's files already. Storage may
   // return HTTP 400 (rather than 404) for a second DELETE, so never use
   // the status of a redundant DELETE as evidence that cleanup failed.
   // Object info readback is the canonical absence check in this fixture.
   const exists=await transport.objectExists({ownerId:path.split('/')[0],
    requestId:R,bucketId:bucket,path});
   if(exists) {
    const deleted=await transport.deleteObject({ownerId:path.split('/')[0],
     requestId:R,bucketId:bucket,path});
    assert.ok(deleted.deleted||deleted.alreadyAbsent,
     'Disposable object cleanup was not acknowledged');
   }
   assert.equal(await transport.objectExists({ownerId:path.split('/')[0],
    requestId:R,bucketId:bucket,path}),false,
    'Disposable object still present after cleanup');
  }
  const r=await storage('DELETE','/bucket/'+bucket);
  assert.ok(r.ok,'Disposable bucket cleanup failed: HTTP '+r.status);
 }
}
