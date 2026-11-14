/**
 * ALL-251 disposable staging-only real Auth A/B session gate acceptance.
 * MANUAL protected environment only. NO Storage writes or R2 access.
 * Does not prove full ALL-251 Storage release acceptance.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
const REF='fbtgknlxjyeqrxemskbl';
const ORIGIN='https://'+REF+'.supabase.co';
const env=process.env;
assert.equal(env.CI,'true');
assert.equal(env.ALL251_SESSION_GATE_APPROVED,'true');
assert.equal(env.ALL251_STAGING_REF,REF);
assert.equal(env.ALL251_STAGING_URL,ORIGIN);
const privileged=env.ALL251_TEMP_STAGING_SECRET_KEY;
const publishable=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(privileged??''),'Protected staging secret required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishable??''),'Staging publishable key required');
const owners=[],cleanupIssues=[],results=[];
const password=randomBytes(24).toString('base64url')+'Aa1!';
async function post(path,body,{key=privileged,jwt=null}={}){
 const res=await fetch(ORIGIN+path,{method:'POST',redirect:'manual',
  signal:AbortSignal.timeout(20000),
  headers:{apikey:key,authorization:'Bearer '+(jwt??key),
   'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify(body)});
 assert(![301,302,303,307,308].includes(res.status),'Untrusted redirect');
 return res;
}
async function user(){
 const email='all251-http-'+randomUUID()+'@example.invalid';
 const created=await post('/auth/v1/admin/users',{
  email,password,email_confirm:true,app_metadata:{all251_httpmatrix:true},
 });
 assert([200,201].includes(created.status),'Synthetic Auth create failed');
 const {id}=await created.json();
 assert(typeof id==='string','Auth did not return user');
 owners.push(id);
 const login=await post('/auth/v1/token?grant_type=password',
  {email,password},{key:publishable});
 assert.equal(login.status,200,'Synthetic login failed');
 const session=await login.json();
 assert.equal(session.user?.id,id,'Auth owner identity mismatch');
 assert(typeof session.access_token==='string'&&session.access_token.length>30);
 return {id,jwt:session.access_token};
}
async function check(token){
 const res=await post('/rest/v1/rpc/v2_all251_worker_session_check_review',{},
  {key:publishable,jwt:token});
 if(res.status!==200)return {allowed:false,status:res.status};
 const body=await res.json();
 return {allowed:body===true,status:res.status};
}
async function cleanup(){
 for(const id of [...owners].reverse()){
  try{
   const res=await fetch(ORIGIN+'/auth/v1/admin/users/'+id,{
    method:'DELETE',signal:AbortSignal.timeout(20000),redirect:'manual',
    headers:{apikey:privileged,authorization:'Bearer '+privileged}});
   if(!res.ok)cleanupIssues.push('disposable-user-cleanup-denied:'+res.status);
  }catch{cleanupIssues.push('disposable-user-cleanup-exception');}
 }
}
try{
 const a=await user(),b=await user();
 const aBefore=await check(a.jwt),bBefore=await check(b.jwt);
 assert.deepEqual(aBefore,{allowed:true,status:200},'A session not verified');
 assert.deepEqual(bBefore,{allowed:true,status:200},'B session not verified');
 results.push('PASS A/B real active sessions');
 const anon=await post('/rest/v1/rpc/v2_all251_worker_session_check_review',{},
  {key:publishable});
 assert([401,403,404].includes(anon.status),
  'Unauthenticated service reached session gate');
 const elevated=await post('/rest/v1/rpc/v2_all251_worker_session_check_review',{});
 assert([401,403,404].includes(elevated.status),
  'Privileged service key reached owner session gate');
 results.push('PASS anonymous and privileged-role access denied');
 const cross=await post('/rest/v1/rpc/v2_all251_http_matrix_request_deletion',{
  p_expected_user_id:a.id,p_confirmation:'DELETE MY ACCOUNT',
 },{key:publishable,jwt:b.jwt});
 assert([401,403,404].includes(cross.status),'B could request A deletion');
 const frozen=await post('/rest/v1/rpc/v2_all251_http_matrix_request_deletion',{
  p_expected_user_id:a.id,p_confirmation:'DELETE MY ACCOUNT',
 },{key:publishable,jwt:a.jwt});
 assert.equal(frozen.status,200,'A could not request own synthetic deletion');
 assert.equal(await frozen.json(),true,'A request failed');
 const aAfter=await check(a.jwt),bAfter=await check(b.jwt);
 assert.equal(aAfter.allowed,false,'Frozen A session still authorized');
 assert.deepEqual(bAfter,{allowed:true,status:200},
  'B lost independently active session');
 results.push('PASS A deletion blocks A; B continues');
 const logout=await fetch(ORIGIN+'/auth/v1/logout',{method:'POST',redirect:'manual',
  signal:AbortSignal.timeout(20000),
  headers:{apikey:publishable,authorization:'Bearer '+b.jwt}});
 assert([200,204].includes(logout.status),'B logout failed');
 const bRevoked=await check(b.jwt);
 assert.equal(bRevoked.allowed,false,'Revoked B session still authorized');
 results.push('PASS revoked-session denial');
}catch(error){
 process.stderr.write('FAIL '+String(error?.message??'unverified')
  .replace(/[A-Za-z0-9_-]{42,}/g,'[REDACTED]')+'\n');
 process.exitCode=1;
}finally{await cleanup();}
for(const outcome of results)process.stdout.write(outcome+'\n');
if(cleanupIssues.length){
 process.stderr.write('FAIL cleanup '+cleanupIssues.join(',')+'\n');
 process.exitCode=1;
}else process.stdout.write('PASS disposable Auth cleanup\n');
