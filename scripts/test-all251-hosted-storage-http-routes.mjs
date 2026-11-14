/**
 * ALL-251 disposable staging-only HTTP upload-route regression.
 * MANUAL/PROTECTED GitHub environment approval only. NO release authorization.
 * All object paths have a unique test prefix, and are cleaned even on failures.
 * Real S3 privileged SigV4 tests require a separately provisioned S3 key pair:
 * this suite NEVER creates one or substitutes an unrestricted service key.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {signAll251S3} from './all251-s3-sigv4.mjs';
import {createPrivilegedStorageWriter} from
 '../supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs';
import {createAttestedPrivilegedStorageLeaseAuthority} from
 '../supabase/functions/_shared/trainingPrivilegedStorageWriterAttestor.mjs';

const REF='fbtgknlxjyeqrxemskbl';
const ORIGIN='https://'+REF+'.supabase.co';
const DIRECT='https://'+REF+'.storage.supabase.co';
const BUCKET='v2-private-workout-objects';
const API='/storage/v1/';
const env=process.env;
assert.equal(env.CI,'true');
assert.equal(env.ALL251_HTTP_MATRIX_APPROVED,'true');
assert.equal(env.ALL251_STAGING_REF,REF);
assert.equal(env.ALL251_STAGING_URL,ORIGIN);
const privileged=env.ALL251_TEMP_STAGING_SECRET_KEY;
const publishable=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
const writerSignerB64=env.ALL251_TEMP_STAGING_WRITER_SIGNER_B64??'';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert(/^sb_secret_[\w-]+$/.test(privileged??''),'Protected temporary staging secret required');
assert(/^sb_publishable_[\w-]+$/.test(publishable??''),'Approved staging publishable key required');

const owners=[],objects=new Set(),postFreezePaths=new Set(),cleanupIssues=[],outcomes=[];
const tusSessions=new Set(),s3Multipart=new Map();
let trustedWriter=null,signingKey=null;
function verifiedSigner(){
 // The protected environment must provide the approved dedicated signer.
 // A project-wide secret, hardcoded fixture or unsigned service RPC is NEVER
 // an acceptable substitute. No Auth users or Storage bytes created yet.
 if(!/^[A-Za-z0-9+/]{43}=$/.test(writerSignerB64))
  throw Error('BLOCKED: dedicated 32-byte hosted writer signer not provisioned');
 const bytes=Buffer.from(writerSignerB64,'base64');
 if(bytes.byteLength!==32||bytes.toString('base64')!==writerSignerB64)
  throw Error('BLOCKED: invalid protected writer signer');
 return bytes;
}
function trustedStorageClient(){
 const scopedRpc=async(name,args)=>{
  const res=await json('/rest/v1/rpc/'+name,args);
  if(!res.ok)return {data:null,error:{code:'HTTP_'+res.status}};
  return {data:await res.json(),error:null};
 };
 return {
  rpc:scopedRpc,
  storage:{from:bucketId=>{
   assert.equal(bucketId,BUCKET,'Verified writer bucket only');
   return {
    upload:async(path,bytes)=>{
     objects.add(path);
     const res=await upload(path,{bytes});
     return res.ok?{data:{path},error:null}:{data:null,error:{code:'HTTP_'+res.status}};
    },
    update:async(path,bytes)=>{
     objects.add(path);
     const res=await request(API+'object/'+bucketPath(path),{
      method:'PUT',body:bytes,headers:{'content-type':'application/octet-stream'}});
     return res.ok?{data:{path},error:null}:{data:null,error:{code:'HTTP_'+res.status}};
    },
    download:async(path)=>{
     const res=await read(path);
     return res.ok?{data:{arrayBuffer:()=>res.arrayBuffer()},error:null}:
      {data:null,error:{code:'HTTP_'+res.status}};
    },
   };
  }},
 };
}
async function verifiedWriterUpload(owner,path,bytes){
 if(!trustedWriter)throw Error('Canonical attested writer not initialized');
 const result=await trustedWriter.write({
  verifiedOwnerId:owner,bucketId:BUCKET,path,bytes,
  operation:'create',contentType:'application/octet-stream'
 });
 assert.equal(result?.verified,true,'Authorized writer receipt missing');
 const observed=await read(path);
 assert.equal(observed.status,200,'Authorized bytes not readable');
 assert.equal(sha(Buffer.from(await observed.arrayBuffer())),sha(bytes),
  'Provider bytes differ from original canonical writer');
 return result;
}
let a=null,b=null;
let s3PreA=false,s3PreB=false,s3MultipartReady=false;
let s3MultipartA=null;
let signerToken=null,signedPath=null;
let signedBaselinePassed=false,tusBaselinePassed=false;
const password=randomUUID()+'Aa!9';
const prefix='all251-httpmatrix-'+randomUUID();
const bucketPath=p=>BUCKET+'/'+p.split('/').map(encodeURIComponent).join('/');
const mark=(name,status,detail='')=>{
 outcomes.push({name,status,detail});
 process.stdout.write(status+' '+name+(detail?' ('+detail+')':'')+'\n');
};
async function request(path,{method='GET',key=privileged,jwt=null,body,headers={},origin=ORIGIN}={}){
 assert(origin===ORIGIN||origin===DIRECT,'No other host permitted');
 assert(key===privileged||key===publishable,'Unreviewed API key');
 const res=await fetch(origin+path,{method,redirect:'manual',
  signal:AbortSignal.timeout(25000),
  headers:{apikey:key,...(jwt?{authorization:'Bearer '+jwt}:{}),...headers},
  ...(body===undefined?{}:{body})});
 assert(![301,302,303,307,308].includes(res.status),'Untrusted redirect');
 return res;
}
async function json(path,body,{key=privileged,jwt=null}={}){
 return request(path,{method:'POST',key,jwt,body:JSON.stringify(body),
  headers:{'content-type':'application/json'}});
}
async function createOwner(){
 const email='all251-http-'+randomUUID()+'@example.invalid';
 const r=await json('/auth/v1/admin/users',
  {email,password,email_confirm:true,app_metadata:{all251_httpmatrix:true}});
 assert([200,201].includes(r.status),'Disposable staging Auth create denied');
 const user=await r.json();
 assert(typeof user.id==='string');
 owners.push(user.id);
 const login=await json('/auth/v1/token?grant_type=password',{email,password},
  {key:publishable});
 assert.equal(login.status,200,'Synthetic login rejected');
 const data=await login.json();
 assert.equal(data.user?.id,user.id);
 return {id:user.id,jwt:data.access_token};
}
async function cleanup(){
 // Abort every unfinished privileged S3 multipart session before deleting
 // synthetic users. Failed abort remains a visible cleanup FAILURE.
 for(const [id,entry] of s3Multipart){
  try{
   const r=await s3Request('DELETE',entry.path,{query:{uploadId:id}});
   if(![200,202,204,404,410].includes(r.status))
    cleanupIssues.push('s3-multipart-abort-unconfirmed:'+r.status);
   else s3Multipart.delete(id);
  }catch{cleanupIssues.push('s3-multipart-abort-exception');}
 }
 for(const location of tusSessions){
  try{
   const r=await request(location,{method:'DELETE',origin:DIRECT,
    headers:{'tus-resumable':'1.0.0'}});
   if(![200,202,204,404,410].includes(r.status))
    cleanupIssues.push('tus-termination-unconfirmed:'+r.status);
  }catch{cleanupIssues.push('tus-termination-exception');}
 }
 for(const p of [...objects].reverse()){
  try{
   const r=await request(API+'object/'+bucketPath(p),{method:'DELETE'});
   if(!r.ok&&![400,404].includes(r.status))cleanupIssues.push('object-delete:'+r.status);
   const read=await request(API+'object/authenticated/'+bucketPath(p));
   if(read.ok)cleanupIssues.push('object-still-readable');
  }catch{cleanupIssues.push('object-delete-exception');}
 }
 for(const id of [...owners].reverse()){
  try{
   const r=await request('/auth/v1/admin/users/'+id,{method:'DELETE'});
   if(!r.ok)cleanupIssues.push('synthetic-user-delete:'+r.status);
  }catch{cleanupIssues.push('synthetic-user-delete-exception');}
 }
}
function addObject(owner,suffix){
 const p=owner+'/'+prefix+'-'+suffix+'.bin';
 objects.add(p);
 return p;
}
function denied(status){return [400,401,403,404,409,422].includes(status);}
// Report only a bounded provider error CODE, not arbitrary error text,
// tokens, object paths, private media, JWTs or secret-bearing response bodies.
async function safeStorageCode(response){
 if(!response.headers.get('content-type')?.toLowerCase().includes('json'))
  return 'not-json';
 try{
  const body=await response.clone().json();
  if(!body||typeof body!=='object'||Array.isArray(body))return 'unknown';
  const code=[body.code,body.statusCode,body.error].find(value=>
   typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(value));
  return code??'unknown';
 }catch{return 'unknown';}
}
const statusDetail=async response=>'HTTP '+response.status+' code='+await safeStorageCode(response);
async function read(p){
 return request(API+'object/authenticated/'+bucketPath(p));
}
async function upload(p,{key=privileged,jwt=null,bytes=randomBytes(40)}={}){
 return request(API+'object/'+bucketPath(p),{method:'POST',key,jwt,body:bytes,
  headers:{'content-type':'application/octet-stream'}});
}
async function issueSignedUpload(p,{key=privileged,jwt=null}={}){
 return json(API+'object/upload/sign/'+bucketPath(p),{}, {key,jwt});
}
async function redeemSigned(p,token,bytes=randomBytes(46)){
 const url=API+'object/upload/sign/'+bucketPath(p)+'?token='+encodeURIComponent(token);
 return request(url,{method:'PUT',key:publishable,body:bytes,
  headers:{'content-type':'application/octet-stream'}});
}
async function deletionRequest(owner,otherOwner){
 // Dedicated staging-only fixture verifies a real signed-in synthetic owner.
 // Never grant service_role execution or recreate the removed privileged probe.
 const endpoint='/rest/v1/rpc/v2_all251_http_matrix_request_deletion';
 const body={p_expected_user_id:owner.id,p_confirmation:'DELETE MY ACCOUNT'};
 const cross=await json(endpoint,body,{key:publishable,jwt:otherOwner.jwt});
 assert(denied(cross.status),'Other real Auth session could request owner deletion');
 mark('cross-owner synthetic deletion request denied','PASS','HTTP '+cross.status);
 const elevated=await json(endpoint,body);
 assert(denied(elevated.status),'Unrestricted service role reached synthetic deletion fixture');
 mark('service-role synthetic deletion fixture denied','PASS','HTTP '+elevated.status);
 const res=await json(endpoint,body,{key:publishable,jwt:owner.jwt});
 assert.equal(res.status,200,'Owner-scoped synthetic deletion request denied');
 assert.equal(await res.json(),true,'Synthetic deletion request not confirmed');
}
function resumableLocation(response){
 const raw=response.headers.get('location');
 if(!raw)return null;
 const url=new URL(raw,DIRECT);
 assert.equal(url.origin,DIRECT,'Cross-origin TUS session forbidden');
 const result=url.pathname+url.search;
 tusSessions.add(result);
 return result;
}
// Generated S3 keys bypass provider RLS. These probes are deliberately
// negative barriers, never a justification to enable account deletion.
const s3AccessId=env.ALL251_TEMP_STAGING_S3_ACCESS_KEY_ID??'';
const s3Secret=env.ALL251_TEMP_STAGING_S3_SECRET_ACCESS_KEY??'';
const s3Region=env.ALL251_TEMP_STAGING_S3_REGION??'';
const s3Available=Boolean(s3AccessId&&s3Secret&&s3Region);
async function s3Request(method,p,{query={},bytes=Buffer.alloc(0),headers={}}={}){
 if(!s3Available)throw Error('S3 SigV4 credentials not provisioned');
 const host=REF+'.storage.supabase.co';
 const signed=signAll251S3({
  method,host,region:s3Region,accessKeyId:s3AccessId,
  secretAccessKey:s3Secret,bucket:BUCKET,objectPath:p,
  query,bytes
 });
 const res=await fetch(signed.url,{
  method,redirect:'manual',signal:AbortSignal.timeout(25000),
  headers:{...signed.headers,...headers},
  ...(method==='GET'||method==='HEAD'?{}:{body:bytes})
 });
 assert(![301,302,303,307,308].includes(res.status),'S3 redirect forbidden');
 return res;
}
async function s3UploadVerified(owner,label){
 const p=addObject(owner,label),bytes=randomBytes(200);
 const result=await s3Request('PUT',p,{bytes,
  headers:{'content-type':'application/octet-stream'}});
 if(!result.ok)return {success:false,response:result,path:p};
 const observed=await read(p);
 const valid=observed.ok&&sha(Buffer.from(await observed.arrayBuffer()))===sha(bytes);
 if(!valid)mark('S3 credentialed byte readback','FAIL','Missing or changed bytes');
 return {success:valid,response:result,path:p};
}
function s3UploadId(xml){
 const match=xml.match(/<UploadId>([^<]{1,500})<\/UploadId>/);
 return match?.[1]??null;
}
async function tusCreate(p,{key=privileged,jwt=null}={}){
 const m=[['bucketName',BUCKET],['objectName',p],['contentType','application/octet-stream']]
  .map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
 return request(API+'upload/resumable',{method:'POST',key,jwt,origin:DIRECT,
  headers:{'tus-resumable':'1.0.0','upload-length':'50','upload-metadata':m}});
}
try{
 // Fail before allocating disposable Auth users when the authoritative
 // writer attestation is not provisioned. This is a BLOCKER, never a PASS.
 signingKey=verifiedSigner();
 const scoped=trustedStorageClient();
 const authority=createAttestedPrivilegedStorageLeaseAuthority({
  supabase:scoped,signingKey,
 });
 trustedWriter=createPrivilegedStorageWriter({supabase:scoped,leaseAuthority:authority});
 const buckets=await request(API+'bucket');
 assert.equal(buckets.status,200);
 const list=await buckets.json();
 assert(Array.isArray(list)&&list.length===2&&
  list.some(x=>x.id===BUCKET&&x.public===false),'Unexpected staging bucket catalog');
 a=await createOwner();b=await createOwner();
 mark('real staging Auth owner isolation','PASS');
 // Required positive controls: actual hosted Storage POST + SHA256, using
 // canonical signed HMAC lease. Raw privileged uploads should remain denied.
 const canonicalA=addObject(a.id,'attested-pre-freeze');
 const canonicalB=addObject(b.id,'attested-pre-freeze');
 const aBytes=randomBytes(491),bBytes=randomBytes(533);
 await verifiedWriterUpload(a.id,canonicalA,aBytes);
 await verifiedWriterUpload(b.id,canonicalB,bBytes);
 mark('canonical A and B signed pre-freeze provider bytes','PASS');
 // Cross-account read denial is meaningful only when the same owner JWT can
 // actually read its own private bytes. Blanket 403s remain RESTRICTED.
 const aSelfRead=await request(API+'object/authenticated/'+bucketPath(canonicalA),
  {key:publishable,jwt:a.jwt});
 let ownerReadWorked=false;
 if(aSelfRead.ok){
  ownerReadWorked=sha(Buffer.from(await aSelfRead.arrayBuffer()))===sha(aBytes);
  if(!ownerReadWorked)mark('owner JWT own-object readback','FAIL','SHA256 mismatch');
 }else mark('owner JWT own-object readback',denied(aSelfRead.status)?'RESTRICTED':'FAIL',
  await statusDetail(aSelfRead));
 if(ownerReadWorked)mark('owner JWT own-object readback','PASS','SHA256 matched');
 const otherRead=await request(API+'object/authenticated/'+bucketPath(canonicalA),
  {key:publishable,jwt:b.jwt});
 mark('cross-owner JWT private byte read',
  denied(otherRead.status)?(ownerReadWorked?'PASS':'RESTRICTED'):'FAIL',
  await statusDetail(otherRead));

 // Attempt an unsigned S3 bucket request. Credentialed SigV4 remains
 // untested if no generated keypair exists, and must NEVER be marked PASS.
 const s3=await request(API+'s3/'+BUCKET,{method:'HEAD',key:publishable,origin:DIRECT});
 mark('S3 unsigned endpoint',denied(s3.status)?'PASS':'FAIL','HTTP '+s3.status);
 mark('S3 privileged SigV4 / multipart','UNTESTED','no generated S3 credentials provisioned');

 // A successful token mint alone does not prove signed upload writes work.
 // Require a separate, completed, byte-verified pre-freeze signed upload.
 const signedControlPath=addObject(a.id,'signed-control');
 const signedControlMint=await issueSignedUpload(signedControlPath);
 if(signedControlMint.ok){
  const signedControlData=await signedControlMint.json();
  const token=signedControlData.token??signedControlData.data?.token;
  if(typeof token==='string'&&token.length){
   const sourceBytes=randomBytes(46);
   const control=await redeemSigned(signedControlPath,token,sourceBytes);
   if(control.ok){
    const observed=await read(signedControlPath);
    if(observed.ok&&sha(Buffer.from(await observed.arrayBuffer()))===sha(sourceBytes))
     signedBaselinePassed=true;
    else mark('pre-deletion signed upload readback','FAIL','Provider bytes absent or changed');
   }else mark('pre-deletion signed upload redemption',denied(control.status)?'RESTRICTED':'FAIL',
    await statusDetail(control));
  }else mark('pre-deletion signed control token','FAIL','No token');
 }else mark('pre-deletion signed control mint',
  denied(signedControlMint.status)?'RESTRICTED':'FAIL',await statusDetail(signedControlMint));
 mark('pre-deletion signed upload byte control',
  signedBaselinePassed?'PASS':'RESTRICTED',signedBaselinePassed?'SHA256 matched':'no successful write baseline');

 // Pre-request delayed token must remain unredeemed until deletion.
 signedPath=addObject(a.id,'signed-delayed');
 const minted=await issueSignedUpload(signedPath);
 if(minted.ok){
  const payload=await minted.json();
  signerToken=payload.token??payload.data?.token??null;
  if(typeof signerToken!=='string'||!signerToken.length)
   mark('signed upload token format','FAIL','mint returned no token');
  else mark('pre-deletion signed URL minted','OBSERVED');
 }else mark('pre-deletion signed URL minting',denied(minted.status)?'RESTRICTED':'FAIL',(await statusDetail(minted))+' (no delayed token)');

 // A TUS session that only creates but cannot finish is not a write
 // positive control. Finish a separate session and verify its bytes.
 const tusControlPath=addObject(a.id,'tus-control');
 const tusControl=await tusCreate(tusControlPath);
 if([201,204].includes(tusControl.status)){
  const location=resumableLocation(tusControl);
  if(location){
   const sourceBytes=randomBytes(50);
   const completed=await request(location,{method:'PATCH',origin:DIRECT,
    headers:{'tus-resumable':'1.0.0','upload-offset':'0',
     'content-type':'application/offset+octet-stream'},body:sourceBytes});
   if(completed.ok){
    const readback=await read(tusControlPath);
    if(readback.ok&&sha(Buffer.from(await readback.arrayBuffer()))===sha(sourceBytes)){
     tusBaselinePassed=true;
     tusSessions.delete(location); // Fully completed; object cleanup owns bytes.
    }else mark('pre-deletion TUS readback','FAIL','Provider bytes absent or changed');
   }else mark('pre-deletion TUS completion',denied(completed.status)?'RESTRICTED':'FAIL',
    await statusDetail(completed));
  }else mark('pre-deletion TUS control','FAIL','No terminable Location');
 }else mark('pre-deletion TUS creation',
  denied(tusControl.status)?'RESTRICTED':'FAIL',await statusDetail(tusControl));
 mark('pre-deletion TUS byte control',
  tusBaselinePassed?'PASS':'RESTRICTED',tusBaselinePassed?'SHA256 matched':'no successful write baseline');

 const pendingTusPath=addObject(a.id,'tus-predelete-pending');
 const pendingTus=await tusCreate(pendingTusPath);
 let pendingTusLocation=null;
 if([201,204].includes(pendingTus.status)){
  pendingTusLocation=resumableLocation(pendingTus);
  if(pendingTusLocation)mark('pre-deletion TUS session created','OBSERVED');
  else{
   mark('pre-deletion TUS session created','FAIL','No terminable Location');
   cleanupIssues.push('pre-deletion-tus-without-location');
  }
 }else mark('pre-deletion TUS session creation',
  denied(pendingTus.status)?'RESTRICTED':'FAIL',await statusDetail(pendingTus));
 // B must have a valid positive control before A is frozen. Otherwise B's
 // post-freeze 400 is a blanket-denial baseline, NOT proof of independence.
 const bPrePath=addObject(b.id,'independent-before-freeze');
 const bPreBytes=randomBytes(40);
 const bPre=await upload(bPrePath,{key:publishable,jwt:b.jwt,bytes:bPreBytes});
 let bPreWorked=false;
 if(bPre.ok){
  const verify=await read(bPrePath);
  bPreWorked=verify.ok&&sha(Buffer.from(await verify.arrayBuffer()))===sha(bPreBytes);
 }
 mark('independent B user-scoped REST baseline',
  bPre.ok?(bPreWorked?'PASS':'FAIL'):denied(bPre.status)?'RESTRICTED':'FAIL',
  bPre.ok?(bPreWorked?'SHA256 matched':'missing or mismatched bytes'):await statusDetail(bPre));
 const crossWritePath=addObject(a.id,'cross-owner-jwt');
 const crossWrite=await upload(crossWritePath,{key:publishable,jwt:b.jwt});
 mark('cross-owner JWT private upload denied',
  denied(crossWrite.status)?(bPreWorked?'PASS':'RESTRICTED'):'FAIL',
  await statusDetail(crossWrite));
 // Match the owner's post-freeze JWT route to an actual completed,
 // byte-verified owner JWT upload before the deletion request.
 const aJwtPrePath=addObject(a.id,'owner-jwt-rest-before-delete');
 const aJwtPreBytes=randomBytes(40);
 const aJwtPre=await upload(aJwtPrePath,{key:publishable,jwt:a.jwt,bytes:aJwtPreBytes});
 let aJwtPreWorked=false;
 if(aJwtPre.ok){
  const verify=await read(aJwtPrePath);
  aJwtPreWorked=verify.ok&&sha(Buffer.from(await verify.arrayBuffer()))===sha(aJwtPreBytes);
 }
 mark('owner A pre-deletion JWT REST byte baseline',
  aJwtPre.ok?(aJwtPreWorked?'PASS':'FAIL'):
   denied(aJwtPre.status)?'RESTRICTED':'FAIL',
  aJwtPre.ok?(aJwtPreWorked?'SHA256 matched':'missing or mismatched bytes'):
   await statusDetail(aJwtPre));
 const preRestPath=addObject(a.id,'privileged-rest-before-delete');
 const preRestBytes=randomBytes(40);
 const preRest=await upload(preRestPath,{bytes:preRestBytes});
 let preRestWorked=false;
 if(preRest.ok){
  const verify=await read(preRestPath);
  preRestWorked=verify.ok&&sha(Buffer.from(await verify.arrayBuffer()))===sha(preRestBytes);
 }
 mark('pre-deletion privileged REST upload baseline',
  preRest.ok?(preRestWorked?'PASS':'FAIL'):denied(preRest.status)?'RESTRICTED':'FAIL',
  preRest.ok?(preRestWorked?'SHA256 matched':'missing or mismatched bytes'):await statusDetail(preRest));
 await deletionRequest(a,b);
 mark('canonical synthetic deletion request','PASS');
 // Same verified attested writer must fail to acquire A's lease after the
 // freeze, while B retains the ability to write and read original bytes.
 const aAfter=addObject(a.id,'attested-post-freeze');
 let rejected=false;
 try{
  await verifiedWriterUpload(a.id,aAfter,randomBytes(424));
 }catch{rejected=true;}
 mark('canonical A signed write denied after deletion',rejected?'PASS':'FAIL');
 if(rejected){
  const observed=await read(aAfter);
  if(observed.ok)mark('canonical A forbidden post-freeze bytes remain','FAIL');
 }
 const bAfter=addObject(b.id,'attested-post-freeze');
 await verifiedWriterUpload(b.id,bAfter,randomBytes(577));
 mark('canonical B signed write accepted after A deletion','PASS');
 if(pendingTusLocation){
  const result=await request(pendingTusLocation,{method:'PATCH',origin:DIRECT,
   headers:{'tus-resumable':'1.0.0','upload-offset':'0',
    'content-type':'application/offset+octet-stream'},body:randomBytes(50)});
  if(result.ok)postFreezePaths.add(pendingTusPath);
  mark('delayed pre-deletion TUS completion',
   denied(result.status)?(tusBaselinePassed?'PASS':'RESTRICTED'):'FAIL',
   await statusDetail(result));
 }else mark('delayed pre-deletion TUS completion','UNTESTED','no pre-deletion session');

 const restPath=addObject(a.id,'privileged-rest-late');
 postFreezePaths.add(restPath);
 const rest=await upload(restPath);
 mark('post-deletion privileged REST POST',
  denied(rest.status)?(preRestWorked?'PASS':'RESTRICTED'):'FAIL',
  (await statusDetail(rest))+(preRestWorked?' (verified byte baseline)':' (no verified byte baseline)'));

 const ordinaryPath=addObject(a.id,'owner-jwt-rest-late');
 postFreezePaths.add(ordinaryPath);
 const ordinary=await upload(ordinaryPath,{key:publishable,jwt:a.jwt});
 mark('post-deletion user JWT REST POST',
  denied(ordinary.status)?(aJwtPreWorked?'PASS':'RESTRICTED'):'FAIL',
  await statusDetail(ordinary));

 const freshSignedPath=addObject(a.id,'signed-mint-late');
 postFreezePaths.add(freshSignedPath);
 const mintLate=await issueSignedUpload(freshSignedPath);
 mark('post-deletion privileged signed upload mint',denied(mintLate.status)?(signedBaselinePassed?'PASS':'RESTRICTED'):'FAIL',await statusDetail(mintLate));

 if(signerToken){
  const completed=await redeemSigned(signedPath,signerToken);
  if(completed.ok)postFreezePaths.add(signedPath);
  mark('delayed pre-minted signed upload completion',
   denied(completed.status)?(signedBaselinePassed?'PASS':'RESTRICTED'):'FAIL',
   await statusDetail(completed));
 }else mark('delayed pre-minted signed upload completion','UNTESTED','no valid signed token');

 // No TUS session is created prior to deletion: a dangling pre-deletion
 // resumable URL could survive this test and cannot be safely garbage
 // collected without verified termination support.
 const tusPath=addObject(a.id,'tus-late');
 postFreezePaths.add(tusPath);
 const tus=await tusCreate(tusPath);
 mark('post-deletion TUS resumable creation',
  denied(tus.status)?(tusBaselinePassed?'PASS':'RESTRICTED'):'FAIL',
  await statusDetail(tus));
 if([201,204].includes(tus.status)){
  const location=resumableLocation(tus);
  if(location){
   const result=await request(location,{method:'PATCH',origin:DIRECT,
    headers:{'tus-resumable':'1.0.0','upload-offset':'0',
     'content-type':'application/offset+octet-stream'},body:randomBytes(50)});
   mark('TUS post-deletion completion',denied(result.status)?'RESTRICTED':'FAIL',await statusDetail(result));
  }else{
   mark('TUS completion','UNTESTED','creation had no Location header');
   cleanupIssues.push('TUS-session-created-without-terminable-location');
  }
 }else mark('TUS completion','UNTESTED','TUS creation rejected');

 // One user must not gain rights to the other owner's deleted content.
 const bPath=addObject(b.id,'independent-owner');
 const bUser=await upload(bPath,{key:publishable,jwt:b.jwt});
 mark('independent B user-scoped REST after A deletion',
  bUser.ok?(bPreWorked?'PASS':'RESTRICTED'):
  denied(bUser.status)?'UNTESTED':'FAIL',
  (await statusDetail(bUser))+
    (bPreWorked?' (B byte baseline worked)':' (B byte baseline not established)'));

 // A deletion REQUEST is not the deletion worker. Existing A objects must
 // remain readable until separately approved deletion runs; only newly
 // uploaded post-freeze bytes constitute a freeze violation here.
 for(const p of postFreezePaths){
  if(!p.startsWith(a.id+'/'))continue;
  const r=await read(p);
  if(r.ok)mark('post-freeze owner bytes created','FAIL');
 }
}catch(err){
 const msg=String(err?.message??'unexpected').replace(/[A-Za-z0-9_-]{42,}/g,'[REDACTED]');
 mark('test harness exception','FAIL',msg);
}finally{
 if(signingKey)signingKey.fill(0);
 await cleanup();
}
if(cleanupIssues.length)mark('cleanup','FAIL',cleanupIssues.join(','));
else mark('cleanup','PASS','all synthetic object paths checked and disposable users removed');
const failed=outcomes.filter(x=>x.status==='FAIL');
const untested=outcomes.filter(x=>x.status==='UNTESTED'||x.status==='RESTRICTED'||x.status==='OBSERVED');
process.stdout.write('ALL-251 real HTTP route outcomes: '+outcomes.length+'; failures='+failed.length+'; not-proven='+untested.length+'\n');
if(failed.length||untested.length)throw Error('ALL-251 hosted Storage exclusive security acceptance remains BLOCKED');
