/** ALL-251 real disposable PostgreSQL RPC acceptance. Never deployed. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createDeletionCheckpointDatabaseReviewAdapter} from '../supabase/functions/_shared/trainingDeletionCheckpointDbVerifierReview.mjs';
if(process.env.CI!=='1')throw Error('Disposable CI only');
const env=Object.fromEntries(execFileSync('supabase',['status','-o','env'],{
 encoding:'utf8',timeout:15000}).split(/\r?\n/)
 .map(s=>s.match(/^(?:export )?([A-Z_]+)=(.*)$/)).filter(Boolean)
 .map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const url=new URL(env.API_URL);
if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)
 ||url.port!=='54321'||!env.SERVICE_ROLE_KEY)
 throw Error('Refuse nonlocal database checkpoint test');
const names=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.Names}}'],{
 encoding:'utf8'}).trim().split('\n').filter(Boolean);
if(names.length!==1||!/^supabase_db_[a-z0-9_-]+$/.test(names[0]))
 throw Error('Exactly one disposable Supabase DB required');
function db(sql){
 const p=spawnSync('docker',['exec','-i',names[0],'psql','-X','-1','-U','postgres',
  '-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000});
 if(p.error||p.status!==0)throw Error('Local PostgreSQL review failed: '+(p.stderr||p.error));
 return p.stdout;
}
const A='a1111111-a111-4111-8111-a11111111111';
const B='b2222222-b222-4222-8222-b22222222222';
const R='c3333333-c333-4333-8333-c33333333333';
const bucket='v2-private-workout-objects',paths=[A+'/one.fit',A+'/nested/two.fit'];
const proc='v2_review_account_deletion_bucket_checkpoints';
async function call(key,args){
 const res=await fetch(url.origin+'/rest/v1/rpc/'+proc,{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,
   'content-type':'application/json'},body:JSON.stringify(args),
  signal:AbortSignal.timeout(12000)});
 return {status:res.status,body:await res.json().catch(()=>null)};
}
const client={rpc:async(name,args)=>{
 assert.equal(name,proc);
 const result=await call(env.SERVICE_ROLE_KEY,args);
 return result.status===200?{data:result.body,error:null}:{data:null,error:result};
}};
const verifier=createDeletionCheckpointDatabaseReviewAdapter({supabase:client});
const scope={ownerId:A,requestId:R,bucketId:bucket,plannedCount:2};
const args={p_expected_owner_id:A,p_expected_request_id:R,p_bucket_id:bucket,p_expected_count:2};
const schema=readFileSync('docs/architecture/sql/V2-ACCOUNT-DELETION-STORAGE-CHECKPOINT-REVIEW.sql','utf8');
const cleanup=`
 DROP FUNCTION public.v2_review_account_deletion_bucket_checkpoints(uuid,uuid,text,integer);
 DROP FUNCTION allin_private.v2_deletion_storage_bucket_checkpoints_review(uuid,uuid,text);
 DROP FUNCTION allin_private.v2_deletion_checkpoint_absence_review(uuid,uuid,text,text);
 DROP FUNCTION allin_private.v2_deletion_storage_plan_review(uuid,uuid,text,text[]);
 DROP TABLE allin_private.v2_account_deletion_storage_checkpoint_review;
 DROP TABLE allin_private.v2_account_deletion_storage_plan_review;
 DELETE FROM allin_private.v2_account_deletion_execution_audit
 WHERE request_id='${R}'::uuid AND user_id='${A}'::uuid;
 NOTIFY pgrst,'reload schema';`;
let installed=false;
try{
 const setup=`
 DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM allin_private.v2_account_deletion_execution_audit
  WHERE request_id='${R}'::uuid)
 OR to_regclass('allin_private.v2_account_deletion_storage_plan_review') IS NOT NULL
 THEN RAISE EXCEPTION 'Disposable test namespace already exists'; END IF;
 END $guard$;
 `+schema+`
 INSERT INTO allin_private.v2_account_deletion_execution_audit(request_id,user_id,status)
 VALUES('${R}'::uuid,'${A}'::uuid,'processing');
 SELECT allin_private.v2_deletion_storage_plan_review(
 '${A}'::uuid,'${R}'::uuid,'${bucket}',ARRAY['${paths[0]}','${paths[1]}']);
 NOTIFY pgrst,'reload schema';`;
 db(setup);installed=true;
 // Wait briefly for PostgREST to observe the committed NOTIFY.
 let first;
 for(let i=0;i<12;i++){
  first=await call(env.SERVICE_ROLE_KEY,args);
  if(first.status===200)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.equal(first.status,200,'Service RPC not available in disposable PostgREST');
 assert.equal(first.body,false,'Missing checkpoints must not pass');
 assert.equal(await verifier.verifyBucketCheckpoints(scope),false);
 assert.equal(await verifier.verifyBucketCheckpoints({...scope,plannedCount:1}),false);
 const bad=await call(env.ANON_KEY||'invalid',args);
 assert.ok([401,403,404].includes(bad.status),'Anonymous invocation must be denied');
 db(`SELECT allin_private.v2_deletion_checkpoint_absence_review(
  '${A}'::uuid,'${R}'::uuid,'${bucket}','${paths[0]}');`);
 assert.equal(await verifier.verifyBucketCheckpoints(scope),false);
 db(`SELECT allin_private.v2_deletion_checkpoint_absence_review(
  '${A}'::uuid,'${R}'::uuid,'${bucket}','${paths[1]}');`);
 assert.equal(await verifier.verifyBucketCheckpoints(scope),true);
 await assert.rejects(verifier.verifyBucketCheckpoints({...scope,ownerId:B}),/unavailable/);
 assert.equal(await verifier.verifyBucketCheckpoints({...scope,plannedCount:3}),false);
 db(`DELETE FROM allin_private.v2_account_deletion_storage_checkpoint_review
 WHERE request_id='${R}'::uuid AND object_path='${paths[1]}';`);
 assert.equal(await verifier.verifyBucketCheckpoints(scope),false,
  'Removing persisted evidence must revoke success');
 console.log('PASS ALL-251 real PostgreSQL checkpoint RPC: false/true/false, owner and count isolation, anonymous denial');
}finally{
 if(installed)db(cleanup);
}
