/**
 * ALL-251: REAL LOCAL Storage HTTP bytes + REAL PostgreSQL durable
 * plan/checkpoint readback in one bounded test. Disposable CI ONLY.
 * This still uses a TEST-ONLY owner-write-quiescence stub, never authorizes
 * Auth deletion, never proves a hosted upload freeze or retention signoff.
 */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createLocalDeletionStorageTransport} from
 '../supabase/functions/_shared/trainingDeletionLocalStorageTransport.mjs';
import {createDeletionCheckpointDatabaseReviewAdapter} from
 '../supabase/functions/_shared/trainingDeletionCheckpointDbVerifierReview.mjs';
import {reviewPrivateStorageCleanup} from
 '../supabase/functions/_shared/trainingDeletionPrivateStorageReview.mjs';
import {verifyPrivateStorageByteAbsenceReview} from
 '../supabase/functions/_shared/trainingDeletionStorageByteAbsenceReview.mjs';

if(process.env.CI!=='1') throw Error('CI=1 required for disposable Storage/DB test');
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:15000
}).split(/\r?\n/).map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/))
 .filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const endpoint=new URL(env.API_URL);
if(endpoint.protocol!=='http:' || !['localhost','127.0.0.1'].includes(endpoint.hostname)
 ||endpoint.port!=='54321'||typeof env.SERVICE_ROLE_KEY!=='string'
 ||env.SERVICE_ROLE_KEY.length<40) throw Error('Refuse any nonlocal Supabase test');
const names=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.Names}}'],{
 encoding:'utf8',timeout:15000
}).trim().split('\n').filter(Boolean);
if(names.length!==1||!/^supabase_db_[a-z0-9_-]+$/.test(names[0]))
 throw Error('Exactly one local disposable database required');
function db(sql){
 const p=spawnSync('docker',['exec','-i',names[0],'psql','-X','-qAt','-1',
  '-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{
  input:sql,encoding:'utf8',timeout:30000
 });
 if(p.error||p.status!==0)throw Error('Disposable DB command failed: '+(p.stderr||p.error));
 return p.stdout.trim();
}
const ownerA='a1111111-a111-4111-8111-a11111111111';
const ownerB='b2222222-b222-4222-8222-b22222222222';
const request='c3333333-c333-4333-8333-c33333333333';
const bucket='all251-durable-byte-'+randomBytes(5).toString('hex');
const p1=ownerA+'/heart-rate.fit',p2=ownerA+'/nested/route.geojson';
const pB=ownerB+'/other-owner.fit';
const files=new Map([[p1,randomBytes(1223)],[p2,randomBytes(2751)],[pB,randomBytes(3893)]]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=path=>path.split('/').map(encodeURIComponent).join('/');
const transport=createLocalDeletionStorageTransport({
 apiUrl:env.API_URL,serviceRoleKey:env.SERVICE_ROLE_KEY
});
async function storage(method,path,body,contentType='application/json'){
 const headers={apikey:env.SERVICE_ROLE_KEY,
  Authorization:'Bearer '+env.SERVICE_ROLE_KEY};
 if(body!==undefined)headers['Content-Type']=contentType;
 return fetch(endpoint.origin+'/storage/v1'+path,{
  method,headers,body:body===undefined?undefined:
   contentType==='application/json'?JSON.stringify(body):body,
  signal:AbortSignal.timeout(15000)
 });
}
const rpcName='v2_review_account_deletion_bucket_checkpoints';
async function rpc(name,args,key=env.SERVICE_ROLE_KEY){
 const res=await fetch(endpoint.origin+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,
   'content-type':'application/json'},body:JSON.stringify(args),
  signal:AbortSignal.timeout(12000)
 });
 return {status:res.status,body:await res.json().catch(()=>null)};
}
const verifier=createDeletionCheckpointDatabaseReviewAdapter({
 supabase:{rpc:async(name,args)=>{
  assert.equal(name,rpcName);
  const r=await rpc(name,args);
  return r.status===200?{data:r.body,error:null}:{data:null,error:r};
 }}
});
const scope={ownerId:ownerA,requestId:request,bucketId:bucket,plannedCount:2};
const schema=readFileSync('docs/architecture/sql/V2-ACCOUNT-DELETION-STORAGE-CHECKPOINT-REVIEW.sql','utf8');
let installed=false,created=false;
try {
 // This test writes only a unique temporary audit request and two review
 // tables/functions into the throwaway Supabase that the workflow started.
 assert.equal(db("SELECT to_regclass('allin_private.v2_account_deletion_storage_plan_review') IS NULL"),'t');
 assert.equal(db("SELECT count(*) FROM allin_private.v2_account_deletion_execution_audit WHERE request_id='"+request+"'::uuid"),'0');
 db(schema+"\nINSERT INTO allin_private.v2_account_deletion_execution_audit(request_id,user_id,status)"+
   " VALUES('"+request+"'::uuid,'"+ownerA+"'::uuid,'processing');\nNOTIFY pgrst,'reload schema';");
 installed=true;
 const before=await transport.listBucketCatalog();
 assert(!before.some(b=>b.id===bucket),'Refuse existing bucket');
 // Do not trust a sole bucket if older project data are present.
 assert.equal(before.length,0,'Test requires empty isolated Storage catalog');
 const createdResult=await storage('POST','/bucket',{id:bucket,name:bucket,public:false});
 assert(createdResult.ok,'Disposable private Storage bucket creation failed');
 created=true;
 for(const [path,bytes] of files){
  const result=await storage('POST','/object/'+bucket+'/'+encoded(path),
   bytes,'application/octet-stream');
  assert(result.ok,'Disposable private object write failed');
 }
 const otherBefore=await storage('GET','/object/authenticated/'+bucket+'/'+encoded(pB));
 assert(otherBefore.ok,'Other owner source bytes unavailable');
 assert.equal(sha(Buffer.from(await otherBefore.arrayBuffer())),sha(files.get(pB)));
 const initial=await transport.listOwnerStorageObjects({ownerId:ownerA,requestId:request,bucketId:bucket});
 assert.deepEqual(initial.paths.sort(),[p1,p2].sort());
 // A durable immutable DB plan is saved and read back BEFORE deleting a byte.
 const planned=JSON.parse(db("SELECT array_to_json(allin_private.v2_deletion_storage_plan_review('"+
   ownerA+"'::uuid,'"+request+"'::uuid,'"+bucket+"',ARRAY['"+p1+"','"+p2+"']))::text"));
 assert.deepEqual(planned.sort(),[p1,p2].sort());
 const expectedArgs={p_expected_owner_id:ownerA,p_expected_request_id:request,
  p_bucket_id:bucket,p_expected_count:2};
 // PostgREST needs to reload its new RPC; this is readiness polling, not a
 // repeat of a destructive operation.
 let response;
 for(let i=0;i<12;i++){
  response=await rpc(rpcName,expectedArgs);
  if(response.status===200)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.equal(response?.status,200,'Disposable service-only RPC unavailable');
 assert.equal(response.body,false,'Missing checkpoints must reject completeness');
 const anonymous=await rpc(rpcName,expectedArgs,env.ANON_KEY||'invalid');
 assert([401,403,404].includes(anonymous.status),'Anonymous checkpoint probe accepted');
 const readPlan=({ownerId,requestId,bucketId})=>{
  assert.equal(ownerId,ownerA);assert.equal(requestId,request);assert.equal(bucketId,bucket);
  const raw=db("SELECT array_to_json(planned_paths)::text FROM "+
   "allin_private.v2_account_deletion_storage_plan_review WHERE request_id='"+
   request+"'::uuid AND bucket_id='"+bucket+"'");
  if(!raw)throw Error('Durable DB plan not found');
  return JSON.parse(raw);
 };
 const opts={
  ownerId:ownerA,requestId:request,approvedBucketIds:[bucket],
  ...transport,
  persistAndLoadObjectPlan:async s=>({
   ownerId:s.ownerId,requestId:s.requestId,bucketId:s.bucketId,
   durable:true,paths:readPlan(s)
  }),
  recordCheckpoint:async({path,bucketId})=>{
   assert.equal(bucketId,bucket);assert([p1,p2].includes(path));
   db("SELECT allin_private.v2_deletion_checkpoint_absence_review('"+
    ownerA+"'::uuid,'"+request+"'::uuid,'"+bucket+"','"+path+"')");
   return {persisted:true};
  },
  readCheckpoint:async({ownerId,requestId,bucketId,path})=>{
   const found=db("SELECT count(*) FROM allin_private.v2_account_deletion_storage_checkpoint_review"+
    " WHERE request_id='"+request+"'::uuid AND bucket_id='"+bucket+
    "' AND object_path='"+path+"' AND status='absent_verified'");
   return found==='1'?{ownerId,requestId,bucketId,path,state:'absent_verified'}:null;
  },
  verifyBucketCheckpoints:s=>verifier.verifyBucketCheckpoints(s),
  // Not operational: future release must prove real authenticated + privileged
  // owner-write freeze and absence of in-flight uploads across Auth deletion.
  assertOwnerWritesQuiesced:async()=>true,
 };
 const deletion=await reviewPrivateStorageCleanup(opts);
 assert.equal(deletion.reviewOnly,true);
 assert.equal(deletion.verifiedAbsent,2);
 assert.equal(await verifier.verifyBucketCheckpoints(scope),true);
 for(const path of [p1,p2]){
  assert.equal(await transport.objectExists({ownerId:ownerA,requestId:request,bucketId:bucket,path}),false);
  assert.equal(await transport.objectBytesAbsent({ownerId:ownerA,requestId:request,bucketId:bucket,path}),true);
 }
 const absence=await verifyPrivateStorageByteAbsenceReview({
  ...opts,
  readExistingObjectPlan:async s=>({
   ownerId:s.ownerId,requestId:s.requestId,bucketId:s.bucketId,
   durable:true,paths:readPlan(s)
  })
 });
 assert.equal(absence.storageApiAbsenceVerified,true);
 assert.equal(absence.plannedObjectCount,2);
 assert.equal(absence.uploadBarrierEnforced,undefined);
 // Removing just ONE persistent checkpoint revokes the database claim even
 // though all media bytes are absent. No status=completed can be inferred.
 db("DELETE FROM allin_private.v2_account_deletion_storage_checkpoint_review"+
  " WHERE request_id='"+request+"'::uuid AND object_path='"+p2+"'");
 assert.equal(await verifier.verifyBucketCheckpoints(scope),false);
 assert.equal(db("SELECT count(*) FROM allin_private.v2_account_deletion_storage_checkpoint_review"),'1');
 // Independently authorized DB checkpoint repair, never re-delete Storage.
 db("SELECT allin_private.v2_deletion_checkpoint_absence_review('"+
  ownerA+"'::uuid,'"+request+"'::uuid,'"+bucket+"','"+p2+"')");
 assert.equal(await verifier.verifyBucketCheckpoints(scope),true);
 await assert.rejects(verifier.verifyBucketCheckpoints({...scope,ownerId:ownerB}),/unavailable/);
 const otherAfter=await storage('GET','/object/authenticated/'+bucket+'/'+encoded(pB));
 assert(otherAfter.ok,'Other owner private media unexpectedly deleted');
 assert.equal(sha(Buffer.from(await otherAfter.arrayBuffer())),sha(files.get(pB)));
 // Same immutable plan is replayable without duplicating checkpoints.
 const repeat=await reviewPrivateStorageCleanup(opts);
 assert.equal(repeat.verifiedAbsent,2);
 assert.equal(db("SELECT count(*) FROM allin_private.v2_account_deletion_storage_checkpoint_review"),'2');
 assert.equal(db("SELECT count(*) FROM allin_private.v2_account_deletion_execution_audit WHERE request_id='"+
  request+"'::uuid AND status='processing'"),'1');
 console.log('PASS ALL-251 isolated real Storage API byte deletion + durable PostgreSQL plan/checkpoints + independent missing checkpoint denial + foreign-owner preservation');
 console.log('REVIEW ONLY: owner-upload freeze simulated; completePrivateStorage and uploadBarrierEnforced not established');
}finally{
 // Tear down only the disposable objects/bucket created by THIS run.
 if(created){
  for(const path of files.keys()){
   const owner=path.split('/')[0];
   if(await transport.objectExists({ownerId:owner,requestId:request,bucketId:bucket,path})){
    const result=await transport.deleteObject({ownerId:owner,requestId:request,bucketId:bucket,path});
    assert(result.deleted||result.alreadyAbsent,'Temporary object removal not confirmed');
   }
   assert.equal(await transport.objectExists({ownerId:owner,requestId:request,bucketId:bucket,path}),false);
  }
  const removed=await storage('DELETE','/bucket/'+bucket);
  assert(removed.ok,'Disposable test bucket cleanup failed');
 }
 if(installed){
  db("DROP FUNCTION public.v2_review_account_deletion_bucket_checkpoints(uuid,uuid,text,integer);"+
   " DROP FUNCTION allin_private.v2_deletion_storage_bucket_checkpoints_review(uuid,uuid,text);"+
   " DROP FUNCTION allin_private.v2_deletion_checkpoint_absence_review(uuid,uuid,text,text);"+
   " DROP FUNCTION allin_private.v2_deletion_storage_plan_review(uuid,uuid,text,text[]);"+
   " DROP TABLE allin_private.v2_account_deletion_storage_checkpoint_review;"+
   " DROP TABLE allin_private.v2_account_deletion_storage_plan_review;"+
   " DELETE FROM allin_private.v2_account_deletion_execution_audit WHERE request_id='"+
    request+"'::uuid AND user_id='"+ownerA+"'::uuid;"+
   " NOTIFY pgrst,'reload schema';");
 }
}