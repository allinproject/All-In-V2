// ALL-222 staging-only genuine GoTrue Storage HTTP denial acceptance.
// No production environment, shared V1, or simulated JWTs. Never log secrets.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const ref = 'fbtgknlxjyeqrxemskbl';
const base = 'https://' + ref + '.supabase.co';
const env = process.env;
assert.equal(env.CI, 'true');
assert.equal(env.ALL222_STORAGE_HTTP_ALLOW, 'true');
assert.equal(env.ALL251_STAGING_REF, ref);
assert.equal(env.ALL251_STAGING_URL, base);
const secret = env.ALL251_TEMP_STAGING_SECRET_KEY;
const publicKey = env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(secret ?? ''), 'Protected staging secret required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey ?? ''), 'Staging publishable key required');
assert.notEqual(secret, publicKey);

const bucket='v2-private-workout-objects';
const users=[];
const objectPaths=[];
const password=randomUUID()+'Aa!9';
let failed=false, phase='initialization';
async function call(path, {method='GET',body,token,admin=false,headers={}}={}) {
 const url = new URL(path,base);
 assert(url.hostname===ref+'.supabase.co' || url.hostname===ref+'.storage.supabase.co',
  'Unexpected Storage host');
 assert(url.protocol==='https:');
 const h={apikey:admin?secret:publicKey,...headers};
 if(token) {
   assert(token.split('.').length===3,'Real user Auth JWT required');
   h.authorization='Bearer '+token;
 }
 const res=await fetch(url,{method,headers:h,body,redirect:'manual',
   signal:AbortSignal.timeout(30000)});
 return res;
}
async function adminJson(path,{method='GET',body}={}) {
 return call(path,{method,body:body===undefined?undefined:JSON.stringify(body),
   admin:true,headers:body===undefined?{}:{'content-type':'application/json'}});
}
async function makeUser(){
 const email='all222-http-'+randomUUID()+'@example.invalid';
 const response=await adminJson('/auth/v1/admin/users',{method:'POST',
   body:{email,password,email_confirm:true,user_metadata:{all222_disposable:true}}});
 assert([200,201].includes(response.status),'GoTrue admin creation failed');
 const record=await response.json();
 assert(/^[a-f0-9-]{36}$/i.test(record.id),'Missing Auth ID');
 users.push(record.id);
 const login=await call('/auth/v1/token?grant_type=password',{method:'POST',
   body:JSON.stringify({email,password}),headers:{'content-type':'application/json'}});
 assert.equal(login.status,200,'Real GoTrue sign-in failed');
 const session=await login.json();
 assert.equal(session.user?.id,record.id,'Auth user ID mismatch');
 assert(session.access_token?.split('.').length===3,'No signed Auth JWT');
 return {id:record.id,token:session.access_token};
}
const statusDenied=(code)=>[400,401,403,409,422].includes(code);
async function assertAbsent(ownerToken,path){
 const read=await call('/storage/v1/object/authenticated/'+bucket+'/'+path,{token:ownerToken});
 assert([400,401,403,404].includes(read.status),'Unexpectedly readable private object');
}
async function ordinaryUpload(token,path) {
 const response=await call('/storage/v1/object/'+bucket+'/'+path,{
  method:'POST',token,headers:{'content-type':'application/octet-stream','x-upsert':'false'},
  body:Buffer.from('ALL222 unleased HTTP probe')});
 assert(statusDenied(response.status),'Ordinary HTTP upload bypassed the lease');
}
const enc=(x)=>Buffer.from(x).toString('base64');
async function tusUpload(token,path){
 const uploadBytes=Buffer.from('ALL222 TUS negative bypass probe');
 const init=await call('/storage/v1/upload/resumable',{
  method:'POST',token,
  headers:{
   'tus-resumable':'1.0.0',
   'upload-length':String(uploadBytes.length),
   'upload-metadata':'bucketName '+enc(bucket)+',objectName '+enc(path)+',contentType '+enc('application/octet-stream')
  }
 });
 if(statusDenied(init.status))return;
 assert.equal(init.status,201,'Unexpected TUS initialization response');
 const location=init.headers.get('location');
 assert(location,'TUS init did not return an upload URL');
 const locationUrl=new URL(location,base);
 assert(locationUrl.hostname===ref+'.supabase.co'||locationUrl.hostname===ref+'.storage.supabase.co',
  'TUS Location changed origin');
 assert(locationUrl.protocol==='https:','TUS Location must use HTTPS');
 const finish=await call(locationUrl.toString(),{
  method:'PATCH',token,headers:{
   'tus-resumable':'1.0.0','upload-offset':'0',
   'content-type':'application/offset+octet-stream'
  },body:uploadBytes
 });
 assert(statusDenied(finish.status),'TUS PATCH completed an upload without an attested lease');
}
async function signedTokenAttempt(token,path){
 // The signed URL issuance endpoint must also fail closed without the
 // authorized object-specific lease. Do not use service credentials to issue.
 const signed=await call('/storage/v1/object/upload/sign/'+bucket+'/'+path,{
  method:'POST',token,headers:{'content-type':'application/json'},body:'{}'});
 if(statusDenied(signed.status))return;
 assert([200,201].includes(signed.status),'Unexpected signed URL response');
 const info=await signed.json();
 assert(typeof info.token==='string' && info.token.length>8,'Missing signed upload token');
 const upload=await call('/storage/v1/object/upload/sign/'+bucket+'/'+path+'?token='+encodeURIComponent(info.token),{
  method:'PUT',token,headers:{'content-type':'application/octet-stream'},
  body:Buffer.from('ALL222 signed upload negative bypass probe')
 });
 assert(statusDenied(upload.status),'Signed upload bypassed attested write lease');
}
try {
 phase='create two real GoTrue accounts';const a=await makeUser(),b=await makeUser();
 const aPrefix=a.id+'/all222-'+randomUUID();
 for(const [name,method,token] of [
   ['ordinary-owner',ordinaryUpload,a.token],
   ['ordinary-cross',ordinaryUpload,b.token],
   ['tus-owner',tusUpload,a.token],
   ['tus-cross',tusUpload,b.token],
   ['signed-owner',signedTokenAttempt,a.token],
 ]) {
   phase=name;
   const path=aPrefix+'-'+name+'.bin';
   objectPaths.push(path);
   await method(token,path);
   await assertAbsent(a.token,path);
   process.stdout.write('PASS '+name+' denied without attested lease and no readable object\\n');
 }
}catch(error){
 failed=true;
 process.stderr.write('FAIL ALL222 HTTP phase: '+phase+
  ' ('+(error instanceof Error ? error.name : 'unexpected error')+
  '; no tokens, IDs, URLs or response bodies printed)\\n');
}finally {
 for(const path of objectPaths) {
   try{
     // Service-role cleanup is restricted to generated disposable paths.
     const rm=await adminJson('/storage/v1/object/'+bucket+'/'+path,{method:'DELETE'});
     assert([200,204,400,404].includes(rm.status),'Storage cleanup rejected');
   }catch{failed=true;process.stderr.write('CLEANUP FAILED: Storage fixture requires inspection\\n');}
 }
 for(const id of users.reverse()) {
   try{
     const response=await adminJson('/auth/v1/admin/users/'+id,{method:'DELETE'});
     assert([200,204].includes(response.status),'GoTrue delete rejected');
     const gone=await adminJson('/auth/v1/admin/users/'+id);
     assert.equal(gone.status,404,'Auth user remains after admin delete');
   }catch{failed=true;process.stderr.write('CLEANUP FAILED: synthetic Auth identity requires inspection\\n');}
 }
 if(!failed)process.stdout.write('PASS: all staging-only HTTP bypass checks and cleanup completed\\n');
}
if(failed)process.exitCode=1;
