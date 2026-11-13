/**
 * ALL-251 disposable staging-only HTTP upload-route regression.
 * MANUAL/PROTECTED GitHub environment approval only. NO release authorization.
 * All object paths have a unique test prefix, and are cleaned even on failures.
 * Real S3 privileged SigV4 tests require a separately provisioned S3 key pair:
 * this suite NEVER creates one or substitutes an unrestricted service key.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';

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
assert(/^sb_secret_[\w-]+$/.test(privileged??''),'Protected temporary staging secret required');
assert(/^sb_publishable_[\w-]+$/.test(publishable??''),'Approved staging publishable key required');

const owners=[],objects=new Set(),cleanupIssues=[],outcomes=[];
let a=null,b=null;
let signerToken=null,signedPath=null;
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
async function redeemSigned(p,token){
 const url=API+'object/upload/sign/'+bucketPath(p)+'?token='+encodeURIComponent(token);
 return request(url,{method:'PUT',key:publishable,body:randomBytes(46),
  headers:{'content-type':'application/octet-stream'}});
}
async function deletionRequest(owner){
 const res=await json('/rest/v1/rpc/v2_all251_temporary_request_deletion_probe',
  {p_owner_id:owner.id,p_request_id:randomUUID()});
 assert.equal(res.status,200,'Temporary deletion probe RPC unavailable');
 assert.equal(await res.json(),true,'Canonical deletion request not confirmed');
}
async function tusCreate(p,{key=privileged,jwt=null}={}){
 const m=[['bucketName',BUCKET],['objectName',p],['contentType','application/octet-stream']]
  .map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
 return request(API+'upload/resumable',{method:'POST',key,jwt,origin:DIRECT,
  headers:{'tus-resumable':'1.0.0','upload-length':'50','upload-metadata':m}});
}
try{
 const buckets=await request(API+'bucket');
 assert.equal(buckets.status,200);
 const list=await buckets.json();
 assert(Array.isArray(list)&&list.length===2&&
  list.some(x=>x.id===BUCKET&&x.public===false),'Unexpected staging bucket catalog');
 a=await createOwner();b=await createOwner();
 mark('real staging Auth owner isolation','PASS');

 // Attempt an unsigned S3 bucket request. Credentialed SigV4 remains
 // untested if no generated keypair exists, and must NEVER be marked PASS.
 const s3=await request(API+'s3/'+BUCKET,{method:'HEAD',key:publishable,origin:DIRECT});
 mark('S3 unsigned endpoint',denied(s3.status)?'PASS':'FAIL','HTTP '+s3.status);
 mark('S3 privileged SigV4 / multipart','UNTESTED','no generated S3 credentials provisioned');

 // Pre-request signed upload capability only for a disposable object.
 signedPath=addObject(a.id,'signed-delayed');
 const minted=await issueSignedUpload(signedPath);
 if(minted.ok){
  const payload=await minted.json();
  signerToken=payload.token??payload.data?.token??null;
  if(typeof signerToken!=='string'||!signerToken.length)
   mark('signed upload token format','FAIL','mint returned no token');
  else mark('pre-deletion signed URL minted','OBSERVED');
 }else mark('pre-deletion signed URL minting',denied(minted.status)?'PASS':'FAIL','HTTP '+minted.status);

 await deletionRequest(a);
 mark('canonical synthetic deletion request','PASS');

 const restPath=addObject(a.id,'privileged-rest-late');
 const rest=await upload(restPath);
 mark('post-deletion privileged REST POST',denied(rest.status)?'PASS':'FAIL','HTTP '+rest.status);

 const ordinaryPath=addObject(a.id,'owner-jwt-rest-late');
 const ordinary=await upload(ordinaryPath,{key:publishable,jwt:a.jwt});
 mark('post-deletion user JWT REST POST',denied(ordinary.status)?'PASS':'FAIL','HTTP '+ordinary.status);

 const freshSignedPath=addObject(a.id,'signed-mint-late');
 const mintLate=await issueSignedUpload(freshSignedPath);
 mark('post-deletion privileged signed upload mint',denied(mintLate.status)?'PASS':'FAIL','HTTP '+mintLate.status);

 if(signerToken){
  const completed=await redeemSigned(signedPath,signerToken);
  mark('delayed pre-minted signed upload completion',denied(completed.status)?'PASS':'FAIL','HTTP '+completed.status);
 }else mark('delayed pre-minted signed upload completion','UNTESTED','no valid signed token');

 // No TUS session is created prior to deletion: a dangling pre-deletion
 // resumable URL could survive this test and cannot be safely garbage
 // collected without verified termination support.
 const tusPath=addObject(a.id,'tus-late');
 const tus=await tusCreate(tusPath);
 mark('post-deletion TUS resumable creation',denied(tus.status)?'PASS':'FAIL','HTTP '+tus.status);
 if([201,204].includes(tus.status)){
  const location=tus.headers.get('location');
  if(location){
   const target=new URL(location,DIRECT);
   assert.equal(target.origin,DIRECT,'Cross-origin TUS Location forbidden');
   try{
    const result=await request(target.pathname+target.search,{method:'PATCH',origin:DIRECT,
     headers:{'tus-resumable':'1.0.0','upload-offset':'0',
      'content-type':'application/offset+octet-stream'},
     body:randomBytes(50)});
    mark('TUS post-deletion completion',denied(result.status)?'PASS':'FAIL','HTTP '+result.status);
   }finally{
    const stopped=await request(target.pathname+target.search,{method:'DELETE',origin:DIRECT,
     headers:{'tus-resumable':'1.0.0'}});
    if(![200,202,204,404,410].includes(stopped.status))
     cleanupIssues.push('TUS-session-unconfirmed-termination:'+stopped.status);
   }
  }else{
   mark('TUS completion','UNTESTED','creation had no Location header');
   cleanupIssues.push('TUS-session-created-without-terminable-location');
  }
 }else mark('TUS completion','UNTESTED','TUS creation rejected');

 // One user must not gain rights to the other owner's deleted content.
 const bPath=addObject(b.id,'independent-owner');
 const bUser=await upload(bPath,{key:publishable,jwt:b.jwt});
 mark('independent B user-scoped REST',bUser.status===200||bUser.status===201?'OBSERVED':denied(bUser.status)?'RESTRICTED':'FAIL','HTTP '+bUser.status);

 for(const p of objects){
  const r=await read(p);
  if(r.ok&&p.startsWith(a.id+'/'))
   mark('private deleted-owner bytes still accessible','FAIL');
 }
}catch(err){
 const msg=String(err?.message??'unexpected').replace(/[A-Za-z0-9_-]{42,}/g,'[REDACTED]');
 mark('test harness exception','FAIL',msg);
}finally{await cleanup();}
if(cleanupIssues.length)mark('cleanup','FAIL',cleanupIssues.join(','));
else mark('cleanup','PASS','all synthetic object paths checked and disposable users removed');
const failed=outcomes.filter(x=>x.status==='FAIL');
const untested=outcomes.filter(x=>x.status==='UNTESTED');
process.stdout.write('ALL-251 real HTTP route outcomes: '+outcomes.length+'; failures='+failed.length+'; not-proven='+untested.length+'\n');
if(failed.length||untested.length)throw Error('ALL-251 hosted Storage exclusive security acceptance remains BLOCKED');
