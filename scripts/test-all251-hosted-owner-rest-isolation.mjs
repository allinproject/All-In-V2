/**
 * ALL-251 protected hosted owner REST isolation acceptance.
 * Temporary staging only. Real JWT sessions and HTTP, no mock Storage.
 * The independently protected attested writer remains the ONLY positive
 * upload route; never pass its HMAC signing key to this runner.
 * This intentionally FAILS until that endpoint is separately approved,
 * deployed and enabled. Never treat a denied baseline as an acceptance pass.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';

const REF='fbtgknlxjyeqrxemskbl';
const ORIGIN='https://'+REF+'.supabase.co';
const BUCKET='v2-private-workout-objects';
const env=process.env;
assert.equal(env.CI,'true');
assert.equal(env.ALL251_OWNER_REST_APPROVED,'true');
assert.equal(env.ALL251_OWNER_REST_STAGING_REF,REF);
const secret=env.ALL251_TEMP_STAGING_SECRET_KEY;
const publishable=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[\w-]+$/.test(secret??''),'Protected staging secret required');
assert(/^sb_publishable_[\w-]+$/.test(publishable??''),'Staging publishable key required');
assert.notEqual(secret,publishable);
const users=[],paths=new Set(),cleanupErrors=[];
const tag='all251-owner-rest-'+randomUUID();
const password=randomUUID()+'Aa!9';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pathFor=p=>BUCKET+'/'+p.split('/').map(encodeURIComponent).join('/');
function denied(r){return [400,401,403,404,409,422].includes(r.status);}
async function request(path,{method='GET',key=publishable,jwt=null,body,headers={}}={}){
 assert(key===secret||key===publishable,'Unreviewed key');
 const r=await fetch(ORIGIN+path,{method,redirect:'manual',
  signal:AbortSignal.timeout(25000),
  headers:{apikey:key,...(jwt?{authorization:'Bearer '+jwt}:{}),...headers},
  ...(body===undefined?{}:{body})});
 assert(![301,302,303,307,308].includes(r.status),'Redirect prohibited');
 return r;
}
async function json(path,data,{key=publishable,jwt=null}={}){
 return request(path,{method:'POST',key,jwt,body:JSON.stringify(data),
  headers:{'content-type':'application/json'}});
}
async function createOwner(){
 const email='all251-owner-rest-'+randomUUID()+'@example.invalid';
 const r=await json('/auth/v1/admin/users',
  {email,password,email_confirm:true,app_metadata:{all251_owner_rest:true}},
  {key:secret});
 assert([200,201].includes(r.status),'Test user creation failed');
 const owner=await r.json();
 assert(typeof owner.id==='string');
 users.push(owner.id);
 const login=await json('/auth/v1/token?grant_type=password',{email,password});
 assert.equal(login.status,200,'Real Auth session unavailable');
 const session=await login.json();
 assert.equal(session.user?.id,owner.id,'Wrong Auth principal');
 return {id:owner.id,jwt:session.access_token};
}
async function restUpload(path,bytes,{jwt}){
 return request('/storage/v1/object/'+pathFor(path),{
  method:'POST',jwt,body:bytes,headers:{'content-type':'application/octet-stream'}});
}
async function get(path,jwt=null){
 return request('/storage/v1/object/authenticated/'+pathFor(path),{jwt});
}
async function trustedUpload(owner,path,bytes){
 return request('/functions/v1/v2-private-storage-writer',{
  method:'POST',jwt:owner.jwt,body:bytes,headers:{
   'content-type':'application/octet-stream',
   'x-allin-bucket':BUCKET,'x-allin-path':path,'x-allin-operation':'create'}});
}
async function cleanup(){
 // Never use user JWT for cleanup: owner may be in requested-deletion state.
 for(const path of [...paths].reverse()){
  try{
   const r=await request('/storage/v1/object/'+pathFor(path),
    {method:'DELETE',key:secret});
   if(!r.ok&&![400,404].includes(r.status))
    cleanupErrors.push('Storage cleanup HTTP '+r.status);
   const check=await request('/storage/v1/object/authenticated/'+pathFor(path),
    {key:secret});
   if(check.ok)cleanupErrors.push('Private byte cleanup not confirmed');
  }catch{cleanupErrors.push('Storage cleanup exception');}
 }
 for(const id of [...users].reverse()){
  try{
   const r=await request('/auth/v1/admin/users/'+id,
    {method:'DELETE',key:secret});
   if(!r.ok)cleanupErrors.push('Auth cleanup HTTP '+r.status);
  }catch{cleanupErrors.push('Auth cleanup exception');}
 }
}
let failure=null;
try{
 const bucket=await request('/storage/v1/bucket/'+BUCKET,{key:secret});
 assert.equal(bucket.status,200,'Staging bucket missing');
 assert.equal((await bucket.json()).public,false,'Bucket unexpectedly public');
 const A=await createOwner(),B=await createOwner();
 assert.notEqual(A.id,B.id);
 console.log('PASS two independent real staging Auth sessions');

 const pathA=A.id+'/'+tag+'-a.bin',pathB=B.id+'/'+tag+'-b.bin';
 paths.add(pathA);paths.add(pathB);
 const unleasedA=await restUpload(pathA,randomBytes(31),{jwt:A.jwt});
 assert(denied(unleasedA),'Unleased owner direct REST write accepted');
 console.log('PASS direct unleased owner REST upload denied HTTP '+unleasedA.status);
 const crossWrite=await restUpload(pathA,randomBytes(32),{jwt:B.jwt});
 assert(denied(crossWrite),'B uploaded into A private path');
 console.log('PASS B cannot upload into A path HTTP '+crossWrite.status);

 const bytesA=randomBytes(521),bytesB=randomBytes(641);
 const written=await trustedUpload(A,pathA,bytesA);
 assert.equal(written.status,201,
  'Trusted attested writer positive control not available; NOT a REST acceptance pass (HTTP '+written.status+')');
 console.log('PASS A written via canonical attested writer');
 const aRead=await get(pathA,A.jwt);
 assert.equal(aRead.status,200,'A cannot read owned private bytes');
 assert.equal(sha(Buffer.from(await aRead.arrayBuffer())),sha(bytesA),
  'A read byte SHA-256 mismatch');
 console.log('PASS A reads own exact bytes via authenticated REST');
 const bRead=await get(pathA,B.jwt);
 assert(denied(bRead),'B read A private bytes');
 const anonymousRead=await get(pathA);
 assert(denied(anonymousRead),'Anonymous read A private bytes');
 console.log('PASS B and anonymous cannot read A bytes HTTP '+bRead.status+'/'+anonymousRead.status);
 const bOverwrite=await request('/storage/v1/object/'+pathFor(pathA),{
  method:'PUT',jwt:B.jwt,body:randomBytes(19),
  headers:{'content-type':'application/octet-stream'}});
 assert(denied(bOverwrite),'B replaced A private bytes');
 const bDelete=await request('/storage/v1/object/'+pathFor(pathA),{
  method:'DELETE',jwt:B.jwt});
 assert(denied(bDelete),'B deleted A private bytes');
 const aStill=await get(pathA,A.jwt);
 assert.equal(aStill.status,200,'A bytes missing after denied B mutations');
 assert.equal(sha(Buffer.from(await aStill.arrayBuffer())),sha(bytesA));
 console.log('PASS B cannot overwrite/delete A; exact bytes unchanged');

 const requested=await json('/rest/v1/rpc/v2_all251_http_matrix_request_deletion',{
  p_expected_user_id:A.id,p_confirmation:'DELETE MY ACCOUNT'},{jwt:A.jwt});
 assert.equal(requested.status,200,'Synthetic canonical deletion request unavailable');
 assert.equal(await requested.json(),true);
 const lateTrustedPath=A.id+'/'+tag+'-late.bin';
 const lateRestPath=A.id+'/'+tag+'-late-rest.bin';
 paths.add(lateTrustedPath);paths.add(lateRestPath);
 const after=await trustedUpload(A,lateTrustedPath,randomBytes(35));
 assert(denied(after),'Trusted writer accepted A after deletion request');
 const blockedREST=await restUpload(lateRestPath,
  randomBytes(35),{jwt:A.jwt});
 assert(denied(blockedREST),'Direct owner REST accepted A after deletion');
 console.log('PASS canonical deletion fences A trusted and direct REST writes');
 const writeB=await trustedUpload(B,pathB,bytesB);
 assert.equal(writeB.status,201,'Independent B writer unavailable');
 const readB=await get(pathB,B.jwt);
 assert.equal(readB.status,200,'B cannot read own bytes');
 assert.equal(sha(Buffer.from(await readB.arrayBuffer())),sha(bytesB));
 console.log('PASS B remains writable/readable during A deletion');
} catch(e){
 const message=String(e?.message??'Unexpected error')
  .replace(/[A-Za-z0-9_-]{42,}/g,'[REDACTED]');
 failure=message;
} finally { await cleanup(); }
if(cleanupErrors.length)throw Error('ALL-251 cleanup incomplete: '+cleanupErrors.join('; '));
if(failure)throw Error('ALL-251 hosted owner REST acceptance BLOCKED: '+failure);
console.log('PASS ALL-251 hosted owner REST isolation and synthetic cleanup');
