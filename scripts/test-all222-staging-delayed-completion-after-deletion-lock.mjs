/**
 * ALL-222 / ALL-251 disposable-staging delayed-completion gate.
 *
 * Create REAL synthetic owner A and mint unfinished provider upload sessions
 * BEFORE A requests deletion; after the deletion lock, prove delayed TUS PATCH,
 * signed PUT and ordinary POST cannot create A's private object bytes.
 *
 * Negative-only; does NOT need operator signer and does not settle a fake lease.
 * The attested writer/signing secret must never be granted to this probe.
 * Only disposable staging fbtgknlxjyeqrxemskbl; no production/deletion worker.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';

const ref='fbtgknlxjyeqrxemskbl';
const origin='https://'+ref+'.supabase.co';
const direct='https://'+ref+'.storage.supabase.co';
const bucket='v2-private-workout-objects';
const env=process.env;
assert.notEqual(env.CI,'true','Operator-only protected staging test');
assert.equal(env.ALL222_STORAGE_HTTP_ALLOW,'true','Explicit staging acceptance needed');
assert.equal(env.ALL251_STAGING_REF,ref,'Wrong staging project');
assert.equal(env.ALL251_STAGING_URL,origin,'Wrong staging URL');
const secret=env.ALL251_TEMP_STAGING_SECRET_KEY;
const pub=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(secret??''),'Staging secret missing');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(pub??''),'Staging publishable missing');

let phase='preflight',failed=false;
const users=[],paths=[],sessions=[];
let owner=null,locked=false;
const password=randomUUID()+'Aa!9';
const encode=p=>p.split('/').map(encodeURIComponent).join('/');
const meta=v=>Buffer.from(v).toString('base64');
async function request(path,{host=origin,method='GET',jwt=null,admin=false,headers={},body}={}){
 assert([origin,direct].includes(host),'Disallowed host');
 const url=new URL(path,host);
 assert(url.origin===host&&url.protocol==='https:','Disallowed URL origin');
 assert(url.pathname.startsWith('/storage/v1/')||url.pathname.startsWith('/auth/v1/')||
   url.pathname.startsWith('/rest/v1/'),'Disallowed API path');
 const result=await fetch(url,{
  method,redirect:'manual',signal:AbortSignal.timeout(45000),
  headers:{apikey:admin?secret:pub,...(jwt?{authorization:'Bearer '+jwt}:{}),...headers},
  ...(body===undefined?{}:{body})
 });
 assert(![301,302,303,307,308].includes(result.status),'Redirect rejected');
 return result;
}
async function admin(path,method='GET',body){
 return request(path,{admin:true,method,
  headers:body===undefined?{}:{'content-type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body)});
}
const pathFor=label=>owner.id+'/all222-delayed-'+randomUUID()+'-'+label+'.bin';
const denial=status=>[400,401,403,404,409,410,422].includes(status);
async function assertConfirmedAbsence(res,label){
 assert([400,404].includes(res.status),label+' must return explicit absent status');
 const info=await res.clone().json().catch(()=>null);
 assert(info&&(info.code==='NoSuchKey'||info.error==='not_found')&&
   info.message==='Object not found',label+' returned unverified absence');
}
async function absence(path){
 const response=await request('/storage/v1/object/authenticated/'+bucket+'/'+encode(path),
  {admin:true});
 await assertConfirmedAbsence(response,'private object bytes');
 const obj=await request('/storage/v1/object/info/'+bucket+'/'+encode(path),{admin:true});
 await assertConfirmedAbsence(obj,'private object metadata');
}
async function tus(url,method,jwt,headers={},body){
 const parsed=new URL(url,direct);
 assert.equal(parsed.origin,direct,'Unexpected TUS origin');
 return request(parsed.pathname+parsed.search,{host:direct,method,jwt,
   headers:{'tus-resumable':'1.0.0',...headers},body});
}
async function setup(){
 phase='create synthetic ALL251 deletion-fixture owner';
 const email='all251-http-'+randomUUID()+'@example.invalid';
 const created=await admin('/auth/v1/admin/users','POST',{
  email,password,email_confirm:true,app_metadata:{all251_httpmatrix:true}});
 assert([200,201].includes(created.status),'Synthetic Auth create rejected');
 const data=await created.json();
 assert(typeof data.id==='string','Missing synthetic user id');
 users.push(data.id);
 const login=await request('/auth/v1/token?grant_type=password',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email,password})});
 assert.equal(login.status,200,'Synthetic real sign-in rejected');
 const session=await login.json();
 assert.equal(session.user?.id,data.id,'Real session owner mismatch');
 assert(session.access_token?.split('.').length===3,'No genuine Auth JWT');
 owner={id:data.id,jwt:session.access_token};
}
async function run(){
 await setup();
 phase='pre-mint TUS session before deletion request';
 const tusPath=pathFor('tus'); paths.push(tusPath);
 const payload=randomBytes(4096);
 const started=await request('/storage/v1/upload/resumable',{host:direct,
  method:'POST',jwt:owner.jwt,
  headers:{'tus-resumable':'1.0.0','upload-length':String(payload.length),
   'upload-metadata':
    'bucketName '+meta(bucket)+',objectName '+meta(tusPath)+
    ',contentType '+meta('application/octet-stream')}});
 // An early denial is safe but cannot prove delayed completion behavior.
 assert.equal(started.status,201,'TUS pre-lock session could not be minted; delayed test inconclusive');
 const location=started.headers.get('location');
 assert(location,'TUS upload Location missing');
 const sessionUrl=new URL(location,direct);
 assert.equal(sessionUrl.origin,direct,'Unexpected TUS origin');
 sessions.push({url:sessionUrl.toString(),jwt:owner.jwt});
 phase='pre-mint signed capability before deletion request';
 const signedPath=pathFor('signed'); paths.push(signedPath);
 const issued=await request('/storage/v1/object/upload/sign/'+bucket+'/'+encode(signedPath),{
  method:'POST',jwt:owner.jwt,headers:{'content-type':'application/json'},body:'{}'});
 assert([200,201].includes(issued.status),'Signed URL pre-lock mint denied; delayed test inconclusive');
 const capability=await issued.json();
 assert(typeof capability.token==='string'&&capability.token.length>8,'Missing signed upload token');
 phase='request real synthetic deletion lock';
 const requestDeletion=await request('/rest/v1/rpc/v2_all251_http_matrix_request_deletion',{
  method:'POST',jwt:owner.jwt,headers:{'content-type':'application/json'},
  body:JSON.stringify({p_expected_user_id:owner.id,p_confirmation:'DELETE MY ACCOUNT'})});
 assert.equal(requestDeletion.status,200,'Synthetic deletion request was denied');
 assert.equal(await requestDeletion.json(),true,'Synthetic deletion request not confirmed');
 locked=true;
 console.log('PASS: real authenticated synthetic account-deletion lock established');
 phase='attempt delayed TUS completion';
 const finish=await tus(sessionUrl,'PATCH',owner.jwt,
  {'upload-offset':'0','content-type':'application/offset+octet-stream'},payload);
 console.log('DELAYED DIAGNOSTIC: TUS PATCH status='+finish.status);
 assert(denial(finish.status),'SECURITY FAIL: pre-issued TUS completed after deletion lock');
 await absence(tusPath);
 phase='attempt delayed signed upload';
 const uploaded=await request('/storage/v1/object/upload/sign/'+bucket+'/'+encode(signedPath)+
  '?token='+encodeURIComponent(capability.token),{
   method:'PUT',jwt:owner.jwt,headers:{'content-type':'application/octet-stream'},body:randomBytes(1024)});
 console.log('DELAYED DIAGNOSTIC: signed PUT status='+uploaded.status);
 assert(denial(uploaded.status),'SECURITY FAIL: pre-issued signed capability wrote after deletion lock');
 await absence(signedPath);
 phase='attempt post-lock ordinary upload';
 const ordinaryPath=pathFor('ordinary');paths.push(ordinaryPath);
 const ordinary=await request('/storage/v1/object/'+bucket+'/'+encode(ordinaryPath),{
   method:'POST',jwt:owner.jwt,
   headers:{'content-type':'application/octet-stream','x-upsert':'false'},body:randomBytes(256)});
 console.log('DELAYED DIAGNOSTIC: ordinary POST status='+ordinary.status);
 assert(denial(ordinary.status),'SECURITY FAIL: ordinary write after deletion lock');
 await absence(ordinaryPath);
 console.log('PASS: real delayed TUS, signed and ordinary uploads denied after deletion lock');
}
async function cleanup(){
 if(locked&&owner){
  try{
   phase='cleanup synthetic deletion request';
   const result=await request('/rest/v1/rpc/v2_all251_http_matrix_cleanup_deletion',{
     method:'POST',jwt:owner.jwt,headers:{'content-type':'application/json'},
     body:JSON.stringify({p_expected_user_id:owner.id})});
   assert.equal(result.status,200,'Synthetic lock cleanup rejected');
   assert.equal(await result.json(),true,'Synthetic lock cleanup unverified');
  }catch{failed=true;console.error('CLEANUP FAIL: deletion request remains; operator inspection needed');}
 }
 for(const {url,jwt} of sessions){
  try{
   const final=await tus(url,'HEAD',jwt);
   console.log('TUS LIFECYCLE DIAGNOSTIC: post-test HEAD status='+final.status);
   if(![404,410].includes(final.status)){
    // No provable TUS session termination route exists in this test. Do not
    // claim provider-level cleanup merely because the DB objects are absent.
    failed=true;
    console.error('CLEANUP UNVERIFIED: provider TUS session requires expiry/termination evidence');
   }
  }catch{failed=true;console.error('CLEANUP UNVERIFIED: TUS HEAD unavailable');}
 }
 for(const path of paths){
  try{
   const response=await admin('/storage/v1/object/'+bucket+'/'+encode(path),'DELETE');
   assert([200,204,400,404].includes(response.status),'Fixture delete unexpected');
   await absence(path);
  }catch{failed=true;console.error('CLEANUP FAIL: Storage fixture inspection required');}
 }
 for(const id of users.reverse()){
  try{
   const result=await admin('/auth/v1/admin/users/'+encodeURIComponent(id),'DELETE');
   assert([200,204].includes(result.status),'Synthetic user deletion rejected');
   const check=await admin('/auth/v1/admin/users/'+encodeURIComponent(id));
   assert.equal(check.status,404,'Synthetic user still present');
  }catch{failed=true;console.error('CLEANUP FAIL: synthetic Auth identity requires inspection');}
 }
}
try{await run();}catch(err){
 failed=true;
 console.error('FAIL checkpoint='+phase+' ('+(err instanceof Error?err.message:'unexpected')+
  '; no JWT, TUS URL, signer or capability logged)');
}finally{await cleanup();}
if(!failed)console.log('PASS ALL-222 delayed-completion staging gate including session cleanup');
if(failed)process.exitCode=1;
