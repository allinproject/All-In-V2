/**
 * ALL-251 protected STAGING ONLY real R2 byte acceptance.
 * No private credentials or bearer tokens may be printed to logs.
 * MUST NOT be interpreted as proof of delayed/multipart/S3 deletion races.
 * Requires approved synthetic-only Worker version and explicit operator opt-in.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const REF='fbtgknlxjyeqrxemskbl';
const SUPABASE='https://'+REF+'.supabase.co';
const WORKER='https://allin365-storage-staging.durbenventures.workers.dev';
const e=process.env;
assert.equal(e.CI,'true');
assert.equal(e.ALL251_R2_HOSTED_OPERATOR_APPROVED,'true');
assert.equal(e.ALL251_STAGING_REF,REF);
assert.equal(e.ALL251_STAGING_URL,SUPABASE);
assert.equal(e.ALL251_R2_WORKER_URL,WORKER);
const secret=e.ALL251_TEMP_STAGING_SECRET_KEY;
const publicKey=e.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(secret??''),'Protected staging Auth admin key required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey??''),'Approved publishable key required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const objects=[],users=[],failures=[],passes=[];
const password=randomBytes(24).toString('base64url')+'Aa1!';
const fakeEmail=()=>'all251-http-'+randomUUID()+'@example.invalid';
async function supa(path,body,{jwt=null,privileged=false}={}){
 const key=privileged?secret:publicKey;
 const response=await fetch(SUPABASE+path,{method:'POST',redirect:'manual',
  signal:AbortSignal.timeout(18000),
  headers:{apikey:key,authorization:'Bearer '+(jwt??key),
   'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify(body)});
 assert(!response.redirected,'Untrusted Supabase redirect');
 return response;
}
async function createUser(label){
 const email=fakeEmail();
 const created=await supa('/auth/v1/admin/users',{
  email,password,email_confirm:true,app_metadata:{all251_httpmatrix:true},
 },{privileged:true});
 assert([200,201].includes(created.status),'Disposable Auth create denied');
 const {id}=await created.json();
 assert(/^[a-f0-9-]{36}$/i.test(id??''),'Disposable Auth owner unavailable');
 const user={label,id,jwt:null,frozen:false};
 users.push(user);
 const login=await supa('/auth/v1/token?grant_type=password',{
  email,password,
 });
 assert.equal(login.status,200,'Disposable sign-in failed');
 const identity=await login.json();
 assert.equal(identity.user?.id,id,'Disposable sign-in owner mismatch');
 assert(typeof identity.access_token==='string'&&identity.access_token.length>30);
 user.jwt=identity.access_token;
 return user;
}
async function worker(method,user,id,{bytes}={}){
 const path='/v1/workouts/'+id;
 const response=await fetch(WORKER+path,{
  method,redirect:'manual',signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+user.jwt,
   ...(bytes?{'content-type':'application/octet-stream'}:{})},
  ...(bytes?{body:bytes}:{}),
 });
 assert(!response.redirected,'Untrusted Worker redirect');
 return response;
}
async function digest(user,id){
 const res=await fetch(WORKER+'/v1/workouts/'+id+'/checksum',{
  redirect:'manual',signal:AbortSignal.timeout(20000),
  headers:{authorization:'Bearer '+user.jwt},
 });
 assert(!res.redirected,'Untrusted checksum redirect');
 if(res.status!==200)return {status:res.status};
 const body=await res.json();
 assert(/^[a-f0-9]{64}$/.test(body?.sha256??''),'Invalid hosted R2 SHA-256');
 assert(Number.isSafeInteger(body?.length),'Invalid hosted R2 byte count');
 return {status:200,sha256:body.sha256,length:body.length};
}
async function write(user){
 const id=randomUUID();
 const bytes=randomBytes(96);
 const expected=sha(bytes);
 // Add the object before network submission; if the HTTP result is
 // ambiguous, cleanup must still attempt removal after freeze.
 objects.push({user,id,expected});
 const res=await worker('POST',user,id,{bytes});
 assert.equal(res.status,201,'Hosted R2 write failed or Worker not activated');
 assert.deepEqual(await res.json(),{code:'CREATED'},'Unexpected R2 write receipt');
 const observed=await digest(user,id);
 assert.deepEqual(observed,{status:200,sha256:expected,length:bytes.length},
  'Hosted R2 content does not match original SHA-256/byte length');
 return {id,expected};
}
async function freeze(user){
 if(user.frozen||!user.jwt)return;
 const res=await supa('/rest/v1/rpc/v2_all251_http_matrix_request_deletion',{
  p_expected_user_id:user.id,p_confirmation:'DELETE MY ACCOUNT',
 },{jwt:user.jwt});
 assert.equal(res.status,200,'Synthetic deletion freeze failed');
 assert.equal(await res.json(),true,'Synthetic deletion freeze not verified');
 user.frozen=true;
}
async function cleanup(){
 // Always attempt clean up when test body fails. An ambiguous write is
 // treated as potentially committed, never silently omitted.
 for(const user of users){
  if(!user.jwt)continue;
  try{await freeze(user);}catch(err){
   failures.push('freeze-before-cleanup:'+user.label+':'+String(err.message).slice(0,70));
  }
 }
 for(const {user,id} of [...objects].reverse()){
  if(!user.frozen){failures.push('r2-cleanup-blocked:'+user.label+'/'+id);continue;}
  try{
   const removed=await worker('DELETE',user,id);
   if(removed.status!==204){
    failures.push('r2-cleanup-not-confirmed:'+user.label+'/'+id+':'+removed.status);
    continue;
   }
   // Do not claim a deleted object without independent owner-context check:
   const check=await digest(user,id);
   // After deletion freeze, checksum is forbidden either way; operator must
   // reconcile exact R2 bucket object inventory before final signoff.
   if(check.status===200)
    failures.push('deleted-object-still-readable:'+user.label+'/'+id);
  }catch(err){
   failures.push('r2-cleanup-unverified:'+user.label+'/'+id);
  }
 }
 for(const user of [...users].reverse()){
  if(user.frozen){
   try{
    const res=await supa('/rest/v1/rpc/v2_all251_http_matrix_cleanup_deletion',{
     p_expected_user_id:user.id,
    },{jwt:user.jwt});
    if(res.status!==200||(await res.json())!==true)
     failures.push('synthetic-deletion-cleanup:'+user.label+':'+res.status);
   }catch{failures.push('synthetic-deletion-cleanup:'+user.label);}
  }
  try{
   const res=await fetch(SUPABASE+'/auth/v1/admin/users/'+user.id,{
    method:'DELETE',redirect:'manual',signal:AbortSignal.timeout(18000),
    headers:{apikey:secret,authorization:'Bearer '+secret},
   });
   if(!res.ok)failures.push('synthetic-auth-cleanup:'+user.label+':'+res.status);
  }catch{failures.push('synthetic-auth-cleanup:'+user.label);}
 }
}
try{
 // The Worker must explicitly be deployed AND activated before creating
 // synthetic Auth accounts. The deny-only live entry returns 403 here.
 const ready=await fetch(WORKER+'/__all251_proof_ready',{
  method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(12000),
 });
 assert.equal(ready.status,204,
  'R2 Worker proof not explicitly activated; no test users created');
 const a=await createUser('A'),b=await createUser('B');
 const firstA=await write(a),firstB=await write(b);
 passes.push('PASS real synthetic A/B R2 writes and SHA-256 byte readback');
 const foreign=await digest(b,firstA.id);
 assert.notEqual(foreign.status,200,'B read A private R2 checksum');
 passes.push('PASS cross-owner private R2 digest denied');
 await freeze(a);
 const frozenAttemptId=randomUUID();
 objects.push({user:a,id:frozenAttemptId,expected:null});
 const frozenAttempt=await worker('POST',a,frozenAttemptId,{bytes:randomBytes(48)});
 assert.notEqual(frozenAttempt.status,201,'Frozen A wrote after deletion request');
 const frozenRead=await digest(a,firstA.id);
 assert.notEqual(frozenRead.status,200,'Frozen A retained authenticated checksum');
 passes.push('PASS post-freeze A writer and checksum denied');
 await write(b);
 passes.push('PASS B remains writable after A deletion freeze');
 const malicious=await worker('DELETE',b,firstA.id);
 assert.notEqual(malicious.status,204,'B removed A object via test cleanup');
 passes.push('PASS B cannot remove A fixture');
}catch(err){
 // Only fixture-safe summary, never full provider error / headers / JWTs.
 failures.push('hosted-test:'+String(err?.message??'Unknown failure')
  .replace(/[A-Za-z0-9_-]{42,}/g,'[REDACTED]').slice(0,160));
}finally{
 await cleanup();
}
for(const p of passes)process.stdout.write(p+'\n');
if(failures.length){
 for(const x of failures)process.stderr.write('FAIL '+x+'\n');
 process.stderr.write('BLOCKED: inspect Cloudflare R2 bucket for orphaned disposable objects before retry\n');
 process.exitCode=1;
}else{
 process.stdout.write('PASS synthetic DELETE receipts and Auth cleanup (independent R2 bucket inventory still required)\n');
 process.stdout.write('PARTIAL ACCEPTANCE: provider R2 A/B bytes, NOT in-flight race, multipart or account deletion release\n');
}
