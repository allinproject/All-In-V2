/**
 * ALL-251: operator-controlled, temporary staging acceptance ONLY.
 * Reuses the canonical attested writer; it is not another application writer.
 * The 32-byte signing key must be held outside Supabase project-wide Edge
 * Secrets (e.g. isolated operator process). NEVER commit, print or upload it.
 * This cannot prove unrestricted provider key/S3/TUS isolation.
 *
 * Required operator-only environment variables (never in repository):
 * ALL251_OPERATOR_APPROVED=true
 * ALL251_TEMP_STAGING_SECRET_KEY=...      (temporary project ONLY)
 * ALL251_TEMP_STAGING_PUBLISHABLE_KEY=...
 * ALL251_OPERATOR_SIGNER_BASE64=...       (exact same independently provisioned DB key)
 *
 * Only invoke after reviewing staged attested SQL activation and credential
 * custody; never from push CI and never with production credentials.
 */
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPrivilegedStorageWriter} from
 '../supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs';
import {createAttestedPrivilegedStorageLeaseAuthority} from
 '../supabase/functions/_shared/trainingPrivilegedStorageWriterAttestor.mjs';

const PROJECT='fbtgknlxjyeqrxemskbl';
const ORIGIN='https://'+PROJECT+'.supabase.co';
const BUCKET='v2-private-workout-objects';
const API='/storage/v1/';
const encode=p=>p.split('/').map(encodeURIComponent).join('/');
const denied=s=>[400,401,403,404,409,422].includes(s);

function config(env){
 assert.notEqual(env.CI,'true','This is an operator-only staging test, not CI');
 assert.equal(env.ALL251_OPERATOR_APPROVED,'true');
 const secret=env.ALL251_TEMP_STAGING_SECRET_KEY;
 const pub=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
 const keyB64=env.ALL251_OPERATOR_SIGNER_BASE64;
 assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(secret??''),'Staging secret missing');
 assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(pub??''),'Publishable key missing');
 assert(/^[A-Za-z0-9+/]{43}=$/.test(keyB64??''),'32-byte signer missing');
 assert.notEqual(secret,pub);
 const signer=Uint8Array.from(Buffer.from(keyB64,'base64'));
 assert.equal(signer.length,32);
 return {secret,pub,signer};
}
export function validateOperatorConfig(env){
 // Deliberately return no secret data to callers.
 const c=config(env);
 c.signer.fill(0);
 return true;
}

async function exercise(){
 const {secret,pub,signer}=config(process.env);
 const users=[],objects=new Set(),cleanupErrors=[];
 const password=randomUUID()+'Aa!9';
 let ownerA=null,ownerB=null;
 async function request(path,{method='GET',key=secret,jwt=null,bytes,body,contentType}={}){
  assert(key===secret||key===pub,'Unexpected project credential');
  const data=bytes??(body===undefined?undefined:JSON.stringify(body));
  const res=await fetch(ORIGIN+path,{
   method,redirect:'manual',signal:AbortSignal.timeout(25000),
   headers:{apikey:key,...(jwt?{authorization:'Bearer '+jwt}:{}),
    ...(data===undefined?{}:{'content-type':contentType??'application/json'})},
   ...(data===undefined?{}:{body:data}),
  });
  assert(![301,302,303,307,308].includes(res.status),'Redirect denied');
  return res;
 }
 async function rpc(name,body,key=secret,jwt=null){
  const r=await request('/rest/v1/rpc/'+name,{method:'POST',key,jwt,body});
  return r.ok?{data:await r.json(),error:null}:
   {data:null,error:{code:'HTTP_'+r.status}};
 }
 async function createOwner(){
  const email='all251-http-'+randomUUID()+'@example.invalid';
  const r=await request('/auth/v1/admin/users',{
   method:'POST',body:{email,password,email_confirm:true,
    app_metadata:{all251_httpmatrix:true}},
  });
  assert([200,201].includes(r.status),'Staging synthetic Auth create failed');
  const user=await r.json();
  assert(typeof user.id==='string');
  users.push(user.id);
  const login=await request('/auth/v1/token?grant_type=password',{
   method:'POST',key:pub,body:{email,password},
  });
  assert.equal(login.status,200,'Synthetic owner login failed');
  const signed=await login.json();
  assert.equal(signed.user?.id,user.id);
  assert(typeof signed.access_token==='string');
  return {id:user.id,jwt:signed.access_token};
 }
 const supabase={
  rpc:async(name,args)=>rpc(name,args),
  storage:{from:bucket=>{
   assert.equal(bucket,BUCKET,'Non-approved bucket');
   return {
    upload:async(path,bytes)=>{
     objects.add(path);
     const res=await request(API+'object/'+BUCKET+'/'+encode(path),{
      method:'POST',bytes,contentType:'application/octet-stream',
     });
     return res.ok?{data:{path},error:null}:
      {data:null,error:{code:'HTTP_'+res.status}};
    },
    update:async(path,bytes)=>{
     objects.add(path);
     const res=await request(API+'object/'+BUCKET+'/'+encode(path),{
      method:'PUT',bytes,contentType:'application/octet-stream',
     });
     return res.ok?{data:{path},error:null}:
      {data:null,error:{code:'HTTP_'+res.status}};
    },
    download:async path=>{
     const res=await request(API+'object/authenticated/'+BUCKET+'/'+encode(path));
     return res.ok?{data:{arrayBuffer:()=>res.arrayBuffer()},error:null}:
      {data:null,error:{code:'HTTP_'+res.status}};
    },
   };
  }},
 };
 const leaseAuthority=createAttestedPrivilegedStorageLeaseAuthority({
  supabase,signingKey:signer,
 });
 signer.fill(0);
 const writer=createPrivilegedStorageWriter({
  supabase,leaseAuthority,requireAttestedLease:true,
 });
 async function write(user,suffix){
  const path=user.id+'/all251-operator-'+randomUUID()+'-'+suffix+'.bin';
  const data=new Uint8Array(randomBytes(512));
  const receipt=await writer.write({verifiedOwnerId:user.id,bucketId:BUCKET,
   path,bytes:data,operation:'create',contentType:'application/octet-stream'});
  assert.equal(receipt.verified,true);
  return path;
 }
 async function cleanup(){
  for(const path of [...objects].reverse()){
   try{
    const res=await request(API+'object/'+BUCKET+'/'+encode(path),{method:'DELETE'});
    if(!res.ok&&!denied(res.status))cleanupErrors.push('object delete failed');
    const check=await request(API+'object/authenticated/'+BUCKET+'/'+encode(path));
    if(check.ok)cleanupErrors.push('object still readable');
   }catch{cleanupErrors.push('object cleanup exception');}
  }
  for(const id of users.reverse()){
   try{
    const r=await request('/auth/v1/admin/users/'+id,{method:'DELETE'});
    if(!r.ok)cleanupErrors.push('Auth cleanup failed');
   }catch{cleanupErrors.push('Auth cleanup exception');}
  }
 }
 let failure=null;
 try{
  ownerA=await createOwner();ownerB=await createOwner();
  await write(ownerA,'A-before');
  await write(ownerB,'B-before');
  console.log('PASS genuine hosted A and B uploads, exact byte readback and attested settlement');
  const deleteResult=await rpc('v2_all251_http_matrix_request_deletion',{
   p_expected_user_id:ownerA.id,p_confirmation:'DELETE MY ACCOUNT',
  },pub,ownerA.jwt);
  assert.equal(deleteResult.error,null,'Synthetic owner deletion request denied');
  assert.equal(deleteResult.data,true);
  await assert.rejects(write(ownerA,'A-after'),/lease unavailable/,
   'Deleted owner unexpectedly obtained a writer lease');
  await write(ownerB,'B-after');
  console.log('PASS post-request A denied while B still uploads with attested writer');
 }catch(e){failure=e;}
 finally{await cleanup();}
 if(cleanupErrors.length)throw Error('Staging cleanup requires review: '+cleanupErrors.join(','));
 if(failure)throw failure;
 console.log('PASS operator-only staging test cleanup; signed/TUS/S3 delayed completion STILL UNTESTED');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 exercise().catch(e=>{
  // No private key, JWT, response body or user path in output.
  console.error('FAIL staging trusted-writer acceptance: '+String(e?.message??'unknown')
   .replace(/[A-Za-z0-9_-]{32,}/g,'[REDACTED]'));
  process.exitCode=1;
 });
}
