/**
 * ALL-222 temporary-staging POSITIVE upload acceptance — operator-held signer ONLY.
 * Verify actual GoTrue owners, attested Storage create, SHA-256 byte readback,
 * and TUS interrupted/resumed upload at a real Upload-Offset.
 * NO GitHub Actions, no production, no project-wide signer, no deletion worker.
 * Never print credentials, object names, full URLs, session IDs or signatures.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createAttestedPrivilegedStorageLeaseAuthority} from
  '../supabase/functions/_shared/trainingPrivilegedStorageWriterAttestor.mjs';
import {createPrivilegedStorageWriter} from
  '../supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs';

const ref='fbtgknlxjyeqrxemskbl';
const origin='https://'+ref+'.supabase.co';
const direct='https://'+ref+'.storage.supabase.co';
const bucket='v2-private-workout-objects';
const env=process.env;
assert.notEqual(env.CI,'true','Operator-only: CI forbidden');
assert.equal(env.ALL251_OPERATOR_APPROVED,'true','Explicit operator approval required');
assert.equal(env.ALL251_STAGING_REF,ref,'Wrong Supabase project');
assert.equal(env.ALL251_STAGING_URL,origin,'Wrong Supabase origin');
const secret=env.ALL251_TEMP_STAGING_SECRET_KEY;
const publicKey=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
const b64=env.ALL251_OPERATOR_SIGNER_BASE64;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(secret??''),'Staging project secret required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey??''),'Staging project publishable key required');
assert(/^[A-Za-z0-9+/]{43}=$/.test(b64??''),'Independent 32-byte signer required');
const signer=Uint8Array.from(Buffer.from(b64,'base64'));
assert.equal(signer.length,32);
delete process.env.ALL251_OPERATOR_SIGNER_BASE64;
const created=[],users=[],tusUrls=[];
const password=randomUUID()+'Aa!9';
let error=false,checkpoint='preflight',crossOwnerHeadDenied=false;

async function fetchStaging(path,{method='GET',jwt,admin=false,body,headers={},host=origin}={}){
 assert(host===origin||host===direct,'Unapproved host');
 const url = new URL(path,host);
 assert(url.origin===host&&url.protocol==='https:','Cross-origin request denied');
 assert(url.pathname.startsWith('/auth/v1/')||url.pathname.startsWith('/rest/v1/')||
        url.pathname.startsWith('/storage/v1/'),'Unapproved API route');
 const response=await fetch(url,{
  method,redirect:'manual',signal:AbortSignal.timeout(60000),
  headers:{apikey:admin?secret:publicKey,
   ...(jwt?{authorization:'Bearer '+jwt}:{}),...headers},
  ...(body===undefined?{}:{body}),
 });
 assert(![301,302,303,307,308].includes(response.status),'Redirect forbidden');
 return response;
}
const enc=p=>p.split('/').map(encodeURIComponent).join('/');
const pathFor=(id,label)=>id+'/all222-positive-'+randomUUID()+'-'+label+'.bin';
async function adminJson(path,method='GET',data){
 return fetchStaging(path,{method,admin:true,headers:data===undefined?{}:{'content-type':'application/json'},
  body:data===undefined?undefined:JSON.stringify(data)});
}
async function createUser(){
 const email='all222-pos-'+randomUUID()+'@example.invalid';
 const createdUser=await adminJson('/auth/v1/admin/users','POST',
  {email,password,email_confirm:true,app_metadata:{all222_disposable:true}});
 assert([200,201].includes(createdUser.status),'GoTrue synthetic create failed');
 const u=await createdUser.json();
 assert(typeof u.id==='string','Missing synthetic Auth ID');
 users.push(u.id);
 const login=await fetchStaging('/auth/v1/token?grant_type=password',{
  method:'POST',body:JSON.stringify({email,password}),
  headers:{'content-type':'application/json'}});
 assert.equal(login.status,200,'Real GoTrue login failed');
 const session=await login.json();
 assert.equal(session.user?.id,u.id,'Owner ID mismatch');
 assert(session.access_token?.split('.').length===3,'Missing signed JWT');
 return {id:u.id,jwt:session.access_token};
}
async function rpc(name,args){
 const res=await adminJson('/rest/v1/rpc/'+name,'POST',args);
 return res.ok?{data:await res.json(),error:null}:
   {data:null,error:{code:'HTTP_'+res.status}};
}
const supabase={
 rpc,
 storage:{from:chosen=>{
  assert.equal(chosen,bucket,'Unapproved bucket');
  return {
   upload:async(p,bytes)=>{
    created.push(p);
    const res=await fetchStaging('/storage/v1/object/'+bucket+'/'+enc(p),{
      method:'POST',admin:true,body:bytes,
      headers:{'content-type':'application/octet-stream','x-upsert':'false'}});
    return res.ok?{data:{path:p},error:null}:{data:null,error:{status:res.status}};
   },
   download:async p=>{
    const res=await fetchStaging('/storage/v1/object/authenticated/'+bucket+'/'+enc(p),{admin:true});
    return res.ok?{data:{arrayBuffer:()=>res.arrayBuffer()},error:null}:
      {data:null,error:{status:res.status}};
   },
   update:async()=>{throw Error('Replace not authorized by this test');}
  };
 }}
};
const lease=createAttestedPrivilegedStorageLeaseAuthority({supabase,signingKey:signer});
signer.fill(0);
const writer=createPrivilegedStorageWriter({supabase,leaseAuthority:lease,requireAttestedLease:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function verifyReadback(path,expected){
 const response=await fetchStaging('/storage/v1/object/authenticated/'+bucket+'/'+enc(path),{admin:true});
 assert.equal(response.status,200,'Actual Storage byte download failed');
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.equal(bytes.byteLength,expected.byteLength,'Downloaded byte length mismatch');
 assert.equal(sha(bytes),sha(expected),'Storage SHA-256 mismatch');
}
const tusMeta=(items)=>Object.entries(items).map(([k,v])=>k+' '+Buffer.from(v).toString('base64')).join(',');
async function callTus(url,method,jwt,headers={},body){
 const parsed=new URL(url,direct);
 assert(parsed.origin===direct,'Unapproved TUS session origin');
 return fetchStaging(parsed.pathname+parsed.search,{host:direct,method,jwt,
  body,headers:{'tus-resumable':'1.0.0',...headers}});
}
async function run(){
 const a=await createUser(),b=await createUser();
 checkpoint='authorized attested HTTP create';
 for(const user of [a,b]){
  const path=pathFor(user.id,'ordinary');
  const bytes=randomBytes(2048);
  created.push(path);
  const receipt=await writer.write({verifiedOwnerId:user.id,bucketId:bucket,
   path,bytes:new Uint8Array(bytes),operation:'create',contentType:'application/octet-stream'});
  assert.equal(receipt.verified,true,'Attested writer unverified');
  await verifyReadback(path,bytes);
 }
 console.log('PASS: A/B authorized attested create, real bytes, SHA-256 and lease settlement');
 checkpoint='signed URL attested lease';
 const signedBytes=randomBytes(4096);
 const signedPath=pathFor(a.id,'signed');
 created.push(signedPath);
 const authorized=await lease.begin({ownerId:a.id,bucketId:bucket,path:signedPath,
   operation:'create',bytes:new Uint8Array(signedBytes)});
 assert(!authorized.error&&typeof authorized.data==='string','Signed URL lease unavailable');
 checkpoint='signed URL issuance and upload';
 const issued=await fetchStaging('/storage/v1/object/upload/sign/'+bucket+'/'+enc(signedPath),{
  method:'POST',jwt:a.jwt,headers:{'content-type':'application/json'},body:'{}'});
 assert([200,201].includes(issued.status),'Authorized signed URL mint denied');
 const capability=await issued.json();
 assert(typeof capability.token==='string'&&capability.token.length>8,
  'Signed URL bearer token absent');
 const signedWritten=await fetchStaging('/storage/v1/object/upload/sign/'+bucket+'/'+enc(signedPath)+
  '?token='+encodeURIComponent(capability.token),{
   method:'PUT',body:signedBytes,headers:{'content-type':'application/octet-stream'}});
 assert([200,201].includes(signedWritten.status),'Authorized signed upload failed');
 await verifyReadback(signedPath,signedBytes);
 const signedSettle=await lease.settle({ownerId:a.id,leaseId:authorized.data,
   bucketId:bucket,path:signedPath,operation:'create',bytes:new Uint8Array(signedBytes)});
 assert(!signedSettle.error&&signedSettle.data===true,'Signed upload settlement failed');
 console.log('PASS: signed capability upload, exact SHA-256 bytes and attested settlement');
 checkpoint='TUS attested lease begin';
 // 6 MiB first chunk plus remainder: a meaningful pause and resume.
 const bytes=randomBytes(6*1024*1024+1024);
 const path=pathFor(a.id,'resumable');
 created.push(path);
 const started=await lease.begin({ownerId:a.id,bucketId:bucket,path,
   operation:'create',bytes:new Uint8Array(bytes)});
 assert(!started.error&&typeof started.data==='string','Attested TUS lease unavailable');
 const leaseId=started.data;
 checkpoint='TUS creation';
 const init=await fetchStaging('/storage/v1/upload/resumable',{
  host:direct,method:'POST',jwt:a.jwt,
  headers:{'tus-resumable':'1.0.0','upload-length':String(bytes.length),
   'upload-metadata':tusMeta({bucketName:bucket,objectName:path,
      contentType:'application/octet-stream'})}});
 assert.equal(init.status,201,'TUS session creation failed');
 const location=init.headers.get('location');
 assert(location,'TUS server omitted session Location');
 const locationUrl=new URL(location,direct);
 assert.equal(locationUrl.origin,direct,'Unexpected TUS location origin');
 tusUrls.push(locationUrl.toString());
 checkpoint='TUS first chunk';
 const split=6*1024*1024;
 const first=await callTus(locationUrl,'PATCH',a.jwt,
  {'upload-offset':'0','content-type':'application/offset+octet-stream'},bytes.subarray(0,split));
 assert([200,204].includes(first.status),'TUS first chunk failed');
 checkpoint='TUS HEAD offset';
 const head=await callTus(locationUrl,'HEAD',a.jwt);
 assert.equal(head.status,200,'TUS HEAD denied owner');
 assert.equal(head.headers.get('upload-offset'),String(split),'TUS server offset mismatch');
 console.log('PASS: TUS first 6 MiB and server-confirmed resume offset');
 checkpoint='TUS cross-account HEAD boundary';
 const foreignHead=await callTus(locationUrl,'HEAD',b.jwt);
 crossOwnerHeadDenied=[401,403,404].includes(foreignHead.status);
 // Do not upload competing bytes; a bearer TUS URL may be usable by anyone holding it.
 checkpoint='TUS resume from verified offset';
 const second=await callTus(locationUrl,'PATCH',a.jwt,
  {'upload-offset':String(split),'content-type':'application/offset+octet-stream'},
  bytes.subarray(split));
 assert([200,204].includes(second.status),'TUS resumed PATCH failed');
 checkpoint='TUS actual bytes and SHA-256';
 await verifyReadback(path,bytes);
 checkpoint='TUS attested settlement';
 const settled=await lease.settle({ownerId:a.id,leaseId,bucketId:bucket,
   path,operation:'create',bytes:new Uint8Array(bytes)});
 assert(!settled.error&&settled.data===true,'TUS attested settlement failed');
 console.log('PASS: TUS resumed completion, exact bytes SHA-256 and attested settlement');
 assert(crossOwnerHeadDenied,'SECURITY FAIL: B can inspect A TUS session URL using its own JWT');
 console.log('PASS: cross-owner TUS session HEAD rejected');
}
async function cleanup(){
 for(const url of tusUrls){
  try{await callTus(url,'DELETE',null);}catch{ /* provider may not support TUS terminate */ }
 }
 for(const path of [...new Set(created)].reverse()){
  try{
   const deleted=await fetchStaging('/storage/v1/object/'+bucket+'/'+enc(path),{
     method:'DELETE',admin:true});
   if(![200,204].includes(deleted.status))throw Error('Storage delete not acknowledged');
   const read=await fetchStaging('/storage/v1/object/authenticated/'+bucket+'/'+enc(path),{admin:true});
   if(read.ok)throw Error('Bytes remain readable');
   const missing=await read.clone().json().catch(()=>null);
   if(![400,404].includes(read.status)||!missing||
      !(missing.code==='NoSuchKey'||missing.error==='not_found')||
      missing.message!=='Object not found')throw Error('Storage byte absence unconfirmed');
  }catch{error=true;console.error('CLEANUP FAIL: synthetic Storage object requires inspection');}
 }
 for(const id of users.reverse()){
  try{
   const deleted=await adminJson('/auth/v1/admin/users/'+encodeURIComponent(id),'DELETE');
   assert([200,204].includes(deleted.status),'Auth deletion rejected');
   const check=await adminJson('/auth/v1/admin/users/'+encodeURIComponent(id));
   assert.equal(check.status,404,'Synthetic Auth account remains');
  }catch{error=true;console.error('CLEANUP FAIL: synthetic Auth account requires inspection');}
 }
}
try{await run();}catch(e){
 error=true;
 console.error('FAIL checkpoint: '+checkpoint+' ('+(e instanceof Error?e.message:'unexpected')+
  '; no credentials, file URLs or identities logged)');
}finally{await cleanup();}
if(!error)console.log('PASS ALL-222 positive Storage/TUS staging acceptance, cleanup confirmed');
if(error)process.exitCode=1;
