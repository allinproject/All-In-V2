/**
 * ALL-251 TWO-OWNER HOSTED ACCEPTANCE — TEMPORARY STAGING ONLY.
 * Credential only from protected GitHub staging environment. NEVER print it.
 * Uses real GoTrue sessions, real PostgREST lease RPCs and real Storage bytes.
 * No deletion worker, no Auth deletion except its own disposable test users.
 * A direct service-role bypass deliberately FAILS full acceptance.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createPrivilegedStorageWriter} from
 '../supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs';

const REF='fbtgknlxjyeqrxemskbl';
const base='https://'+REF+'.supabase.co';
const env=process.env;
assert.equal(env.CI,'true');
assert.equal(env.ALL251_HOSTED_PRIVILEGED_ALLOW,'true');
assert.equal(env.ALL251_HOSTED_PRIVILEGED_REF,REF);
assert.equal(env.ALL251_HOSTED_PRIVILEGED_URL,base);
const secret=env.ALL251_TEMP_STAGING_SECRET_KEY;
const publishable=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(secret??''),'Approved staging secret required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishable??''),'Staging publishable key required');
assert.notEqual(secret,publishable);
const bucket='v2-private-workout-objects';
const owners=[],createdObjects=[],cleanupErrors=[];
let phase='preflight',directBypassObserved=false;

async function raw(path,{method='GET',key=secret,jwt,body,contentType}={}){
 assert(key===secret||key===publishable,'Wrong project credential');
 const result=await fetch(base+path,{
  method,redirect:'manual',signal:AbortSignal.timeout(25000),
  headers:{apikey:key,...(jwt?{Authorization:'Bearer '+jwt}:{}),
   ...(body!==undefined?{'content-type':contentType??'application/json'}:{})},
  ...(body===undefined?{}:{body:contentType==='application/octet-stream'
   ? body:JSON.stringify(body)}),
 });
 assert(result.status!==301&&result.status!==302&&result.status!==307&&result.status!==308,
  'Redirect refused');
 return result;
}
async function rpc(name,args,{key=secret,jwt}={}){
 return raw('/rest/v1/rpc/'+name,{method:'POST',key,jwt,body:args});
}
async function requireRpc(name,args){
 const response=await rpc(name,args);
 if(response.status!==200)throw Error('Service RPC '+name+' rejected HTTP '+response.status);
 return response.json();
}
async function adminCreate(){
 const email='all251-hosted-writer-'+randomUUID()+'@example.invalid';
 const password=randomUUID()+'aA!9';
 const result=await raw('/auth/v1/admin/users',{method:'POST',
  body:{email,password,email_confirm:true,app_metadata:{all251_hosted_writer:true}}});
 assert([200,201].includes(result.status),'Synthetic Auth creation rejected');
 const user=await result.json();
 assert(typeof user.id==='string','Synthetic Auth identity missing');
 owners.push(user.id);
 const signed=await raw('/auth/v1/token?grant_type=password',{
  method:'POST',key:publishable,body:{email,password}});
 assert.equal(signed.status,200,'Synthetic Auth sign-in failed');
 const token=await signed.json();
 assert.equal(token.user?.id,user.id,'Signed-in owner mismatch');
 assert(typeof token.access_token==='string','Synthetic session absent');
 return {id:user.id,jwt:token.access_token};
}
const sha=data=>createHash('sha256').update(data).digest('hex');
const encodePath=path=>path.split('/').map(encodeURIComponent).join('/');
async function download(path){
 return raw('/storage/v1/object/authenticated/'+bucket+'/'+encodePath(path));
}
async function uploadHttp(path,bytes,replace=false){
 return raw('/storage/v1/object/'+bucket+'/'+encodePath(path),{
  method:replace?'PUT':'POST',body:bytes,contentType:'application/octet-stream'});
}
async function deleteObject(path){
 return raw('/storage/v1/object/'+bucket+'/'+encodePath(path),{method:'DELETE'});
}
function hostedClient(){
 return {
  rpc:async(name,args)=>{
   const result=await rpc(name,args);
   if(result.status!==200)return {data:null,error:{code:'HTTP_'+result.status}};
   return {data:await result.json(),error:null};
  },
  storage:{from:id=>{
   assert.equal(id,bucket,'Only approved private workout bucket');
   return {
    upload:async(path,bytes)=>{
     // Track before sending: even ambiguous upload outcome must be cleaned.
     createdObjects.push(path);
     const result=await uploadHttp(path,bytes,false);
     return result.ok?{data:{path},error:null}:
      {data:null,error:{code:'HTTP_'+result.status}};
    },
    update:async(path,bytes)=>{
     const result=await uploadHttp(path,bytes,true);
     return result.ok?{data:{path},error:null}:
      {data:null,error:{code:'HTTP_'+result.status}};
    },
    download:async(path)=>{
     const result=await download(path);
     if(!result.ok)return {data:null,error:{code:'HTTP_'+result.status}};
     return {data:{arrayBuffer:()=>result.arrayBuffer()},error:null};
    },
   };
  }},
 };
}
async function validateBytes(path,expected){
 const result=await download(path);
 assert.equal(result.status,200,'Private hosted Storage download failed');
 assert.equal(sha(Buffer.from(await result.arrayBuffer())),sha(expected),
  'Stored bytes SHA-256 mismatch');
}
async function cleanup(){
 for(const path of [...new Set(createdObjects)].reverse()){
  try{
   const result=await deleteObject(path);
   if(!result.ok&&![400,404].includes(result.status))
    cleanupErrors.push('Synthetic Storage DELETE failed HTTP '+result.status);
   const verify=await download(path);
   if(verify.ok)cleanupErrors.push('Synthetic Storage bytes still downloadable');
  }catch{cleanupErrors.push('Synthetic Storage cleanup exception');}
 }
 for(const id of [...owners].reverse()){
  try{
   const response=await raw('/auth/v1/admin/users/'+id,{method:'DELETE'});
   if(!response.ok)cleanupErrors.push('Synthetic Auth user cleanup HTTP '+response.status);
  }catch{cleanupErrors.push('Synthetic Auth cleanup exception');}
 }
}
let failure=null;
try{
 phase='initial staging inventory';
 const buckets=await raw('/storage/v1/bucket');
 assert.equal(buckets.status,200,'Staging bucket catalog not available');
 const inventory=await buckets.json();
 assert(Array.isArray(inventory)&&inventory.length===2&&
  inventory.some(b=>b.id===bucket&&b.public===false)&&
  inventory.some(b=>b.id==='v2-private-account-exports'&&b.public===false),
  'Only two approved private staging buckets allowed');
 phase='two real authenticated synthetic accounts';
 const A=await adminCreate(),B=await adminCreate();
 assert.notEqual(A.id,B.id);
 console.log('PASS hosted two disposable Auth sessions created');

 phase='client lease privilege denial';
 const denied=await rpc('v2_begin_privileged_storage_write_review',{
  p_owner_id:A.id,p_bucket_id:bucket,
  p_object_path:A.id+'/client-denied.fit',p_operation:'create',
 },{key:publishable,jwt:A.jwt});
 assert([401,403,404].includes(denied.status),
  'Ordinary signed-in client reached privileged write lease');
 console.log('PASS client cannot acquire privileged upload lease');

 phase='privileged upload and replacement with real byte download';
 const writer=createPrivilegedStorageWriter({supabase:hostedClient()});
 const pA=A.id+'/all251-writer-'+randomUUID()+'.fit';
 const pB=B.id+'/all251-writer-'+randomUUID()+'.fit';
 const bytesA=randomBytes(1536),bytesA2=randomBytes(1912),bytesB=randomBytes(2049);
 assert.equal((await writer.write({verifiedOwnerId:A.id,bucketId:bucket,
  path:pA,bytes:bytesA,operation:'create',
  contentType:'application/octet-stream'})).verified,true);
 assert.equal((await writer.write({verifiedOwnerId:B.id,bucketId:bucket,
  path:pB,bytes:bytesB,operation:'create',
  contentType:'application/octet-stream'})).verified,true);
 await validateBytes(pA,bytesA);await validateBytes(pB,bytesB);
 assert.equal((await writer.write({verifiedOwnerId:A.id,bucketId:bucket,
  path:pA,bytes:bytesA2,operation:'replace',
  contentType:'application/octet-stream'})).verified,true);
 await validateBytes(pA,bytesA2);
 console.log('PASS hosted exact owner lease, real private bytes, replacement and readback');

 phase='unresolved A lease and canonical deletion fence';
 const pRace=A.id+'/all251-unresolved-'+randomUUID()+'.fit';
 const lease=await requireRpc('v2_begin_privileged_storage_write_review',{
  p_owner_id:A.id,p_bucket_id:bucket,p_object_path:pRace,p_operation:'create'});
 assert(typeof lease==='string'&&lease.split('-').length===5,'Durable lease missing');
 const reqA=randomUUID();
 const blocked=await rpc('v2_all251_temporary_request_deletion_probe',{
  p_owner_id:A.id,p_request_id:reqA});
 assert([400,403,409].includes(blocked.status),
  'Pending upload did not prevent deletion request');
 // This lease was only acquired: no HTTP upload was started, so the fixture
 // can conclusively settle it without any delayed Storage outcome.
 assert.equal(await requireRpc('v2_settle_privileged_storage_write_review',{
  p_owner_id:A.id,p_lease_id:lease}),true);
 const requested=await requireRpc('v2_all251_temporary_request_deletion_probe',{
  p_owner_id:A.id,p_request_id:reqA});
 assert.equal(requested,true,'Canonical deletion request not accepted after settled lease');
 await assert.rejects(writer.write({verifiedOwnerId:A.id,bucketId:bucket,
  path:A.id+'/all251-blocked-'+randomUUID()+'.fit',bytes:randomBytes(100),
  operation:'create',contentType:'application/octet-stream'}),/lease unavailable/);
 await validateBytes(pA,bytesA2);await validateBytes(pB,bytesB);
 console.log('PASS hosted unsettled lease fences deletion; accepted deletion blocks new A writer');

 phase='B remains independent of A deletion';
 const pB2=B.id+'/all251-independent-'+randomUUID()+'.fit';
 const moreB=randomBytes(1024);
 assert.equal((await writer.write({verifiedOwnerId:B.id,bucketId:bucket,
  path:pB2,bytes:moreB,operation:'create',
  contentType:'application/octet-stream'})).verified,true);
 await validateBytes(pB2,moreB);
 console.log('PASS B remains writable while A deletion pending');

 phase='service credential bypass detection';
 const pBypass=A.id+'/all251-direct-bypass-'+randomUUID()+'.fit';
 createdObjects.push(pBypass);
 const bypass=await uploadHttp(pBypass,randomBytes(641));
 directBypassObserved=bypass.ok;
 if(directBypassObserved){
  console.log('HOSTED BLOCKER: raw privileged Storage endpoint bypasses controlled writer despite deletion request');
 }else{
  console.log('PASS raw privileged Storage upload blocked by independent provider enforcement');
 }
} catch(error){
 failure=new Error('ALL-251 hosted acceptance failed at '+phase+': '+String(error?.message??'unexpected').replace(/[A-Za-z0-9_-]{40,}/g,'[REDACTED]'));
} finally {
 await cleanup();
}
if(cleanupErrors.length)
 throw Error('ALL-251 hosted cleanup incomplete: '+cleanupErrors.join('; '));
if(failure)throw failure;
if(directBypassObserved)
 throw Error('ALL-251 exclusive privileged Storage enforcement NOT ACCEPTED: direct service-role bypass remains; all synthetic files and users cleaned');
console.log('PASS ALL-251 exclusive hosted privileged writer acceptance and synthetic cleanup');
