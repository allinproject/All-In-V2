
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// ALL-251 only: create and remove two staging-only Auth users. Never log secrets.
const ref='fbtgknlxjyeqrxemskbl';
const base='https://'+ref+'.supabase.co';
const env=process.env;
assert.equal(env.CI,'true');
assert.equal(env.ALL251_STAGING_AUTH_ALLOW,'true');
assert.equal(env.ALL251_STAGING_REF,ref);
assert.equal(env.ALL251_STAGING_URL,base);
const key=env.ALL251_TEMP_STAGING_SECRET_KEY;
const anon=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
// Never mistake the new API keys for signed user JWTs. Reject legacy/mismatched
// values before making any network request.
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(key??''),'Staging-only modern secret key required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(anon??''),'Staging-only modern publishable key required');
assert(key!==anon,'Distinct protected staging credentials required');
const ids=[];
const password=randomUUID()+'aA!9';
async function request(path,{method='GET',body,userJwt=null,apiKey=key}={}){
  // Modern sb_secret_ and sb_publishable_ strings go ONLY in apikey.
  // Authorization is included only for an actual signed-in user's JWT.
  assert(apiKey===key||apiKey===anon,'Untrusted project API key');
  assert(userJwt===null||(typeof userJwt==='string'&&userJwt.split('.').length===3),
    'Expected real Auth session JWT');
  const res=await fetch(base+path,{method,redirect:'manual',
    signal:AbortSignal.timeout(30000),
    headers:{apikey:apiKey,
      ...(userJwt===null?{}:{authorization:'Bearer '+userJwt}),
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(res.redirected,false,'Redirect forbidden');
  return res;
}
async function user(){
 const email='all251-'+randomUUID()+'@example.invalid';
 const res=await request('/auth/v1/admin/users',{method:'POST',
   body:{email,password,email_confirm:true,user_metadata:{all251_synthetic_only:true}}});
 assert([200,201].includes(res.status),'Staging Auth user creation failed');
 const data=await res.json();assert(typeof data.id==='string','Missing Auth user id');
 ids.push(data.id);return {email,id:data.id};
}
async function login(u){
 const res=await request('/auth/v1/token?grant_type=password',
   {method:'POST',apiKey:anon,body:{email:u.email,password}});
 assert.equal(res.status,200,'Synthetic sign-in failed');
 const data=await res.json();
 assert.equal(data.user?.id,u.id,'Owner mismatch');
 assert(data.access_token,'No Auth JWT');
 return data.access_token;
}
let failed=false;
try{
 const a=await user(),b=await user();
 const aToken=await login(a),bToken=await login(b);
 assert.notEqual(aToken,bToken);
 process.stdout.write('PASS: two real isolated synthetic GoTrue sessions\\n');
 // The canonical restricted RPC bridges must never trust a signed-in user
 // directly or authorize an unapproved request, even through a secret-key
 // backend. Verify against real hosted Auth user and session identifiers.
 const sessionId=JSON.parse(Buffer.from(aToken.split('.')[1],'base64url').toString()).session_id;
 assert(/^[a-f0-9-]{36}$/i.test(sessionId??''),'Missing real Auth session claim');
 const args={p_user_id:a.id,p_session_id:sessionId,p_request_id:randomUUID()};
 for(const name of ['v2_account_export_worker_authorize_candidate',
                    'v2_account_export_worker_approve_candidate']){
  const deniedUser=await request('/rest/v1/rpc/'+name,{
   method:'POST',body:args,userJwt:aToken,apiKey:anon});
  assert([401,403,404].includes(deniedUser.status),
    'Ordinary authenticated account reached restricted worker RPC');
  const deniedServer=await request('/rest/v1/rpc/'+name,{
   method:'POST',body:args,apiKey:key});
  assert([400,401,403,404].includes(deniedServer.status),
    'Privileged RPC authorized nonexistent request or missing deletion gate');
 }
 process.stdout.write('PASS: hosted user RPC denies client execution and server RPC rejects missing approval\\n');
 if(env.ALL251_TEST_REAL_APPROVAL==='true'){
  // Synthetic real hosted owner workflow, ONLY while the canonical owner-begin
  // RPC is temporarily granted to authenticated on this isolated staging DB.
  const rpc=async(name,body,token=null,apiKey=key)=>request('/rest/v1/rpc/'+name,{
   method:'POST',body,userJwt:token,apiKey,
  });
  const beginA=await rpc('v2_begin_account_export_candidate',
    {p_expected_user_id:a.id},aToken,anon);
  assert.equal(beginA.status,200,'Owner A could not start a genuine export request');
  const opened=await beginA.json();
  assert.equal(opened.ownerId,a.id);
  assert.equal(opened.status,'requested');
  assert(/^[a-f0-9-]{36}$/i.test(opened.requestId??''));
  const again=await rpc('v2_begin_account_export_candidate',
    {p_expected_user_id:a.id},aToken,anon);
  assert.equal(again.status,200,'Repeat owner initiation was rejected');
  assert.equal((await again.json()).requestId,opened.requestId,'Owner request duplicated');
  const foreignBegin=await rpc('v2_begin_account_export_candidate',
    {p_expected_user_id:a.id},bToken,anon);
  assert([400,401,403].includes(foreignBegin.status),'B began export for A');
  const before=await rpc('v2_account_export_worker_authorize_candidate',
    {p_user_id:a.id,p_session_id:sessionId,p_request_id:opened.requestId});
  assert([400,401,403].includes(before.status),'Unapproved request authorized');
  const wrongSession=JSON.parse(Buffer.from(bToken.split('.')[1],'base64url').toString()).session_id;
  const foreignApprove=await rpc('v2_account_export_worker_approve_candidate',
    {p_user_id:a.id,p_session_id:wrongSession,p_request_id:opened.requestId});
  assert([400,401,403].includes(foreignApprove.status),'Foreign session approved A request');
  const approve=await rpc('v2_account_export_worker_approve_candidate',
    {p_user_id:a.id,p_session_id:sessionId,p_request_id:opened.requestId});
  assert.equal(approve.status,200,'Valid owner request not approved by trusted worker');
  const result=await approve.json();
  assert.equal(result.requestId,opened.requestId);
  assert.equal(result.status,'approved');
  const authorized=await rpc('v2_account_export_worker_authorize_candidate',
    {p_user_id:a.id,p_session_id:sessionId,p_request_id:opened.requestId});
  assert.equal(authorized.status,200,'Owner approved request not authorized');
  assert.equal((await authorized.json()).ownerId,a.id);
  const foreignRead=await rpc('v2_account_export_worker_authorize_candidate',
    {p_user_id:b.id,p_session_id:wrongSession,p_request_id:opened.requestId});
  assert([400,401,403].includes(foreignRead.status),'B authorized A approved request');
  process.stdout.write('PASS: real hosted owner request, idempotency, service approval, exact session and foreign-owner denial\\n');
 }


 if(env.ALL247_TEST_FOOD_RPC==='true'){
  // ALL-247 single canonical Food Log, tested with genuine Auth JWTs against
  // the installed TEMPORARY staging schema only. No other project permitted.
  const rpc=async(name,body,token=null)=>request('/rest/v1/rpc/'+name,{
   method:'POST',body,userJwt:token,apiKey:anon,
  });
  const day='2026-11-12', entryId=randomUUID(), actionId=randomUUID();
  const food={
   p_expected_user_id:a.id,p_action_id:actionId,p_entry_id:entryId,
   p_consumed_at:'2026-11-12T18:00:00Z',p_local_date:day,
   p_timezone_name:'America/Chicago',p_meal_slot:'lunch',
   p_label:'ALL247 synthetic test food',p_quantity:1,p_unit:'serving',
   p_kcal:300,p_nutrition_source:'user_entered',
  };
  const anonymous=await rpc('v2_food_log_read_complete_day',{
   p_expected_user_id:a.id,p_local_date:day,
  });
  assert([401,403,404].includes(anonymous.status),'Anonymous Food Log RPC unexpectedly readable');
  const foreign=await rpc('v2_food_log_read_complete_day',{
   p_expected_user_id:a.id,p_local_date:day,
  },bToken);
  assert([400,401,403].includes(foreign.status),'Other owner accessed Food Log');
  const addition=await rpc('v2_food_log_add_manual',food,aToken);
  assert.equal(addition.status,200,'Owner could not add food via real RPC');
  const added=await addition.json();
  assert.equal(added.id,entryId);
  assert.equal(added.revision,1);
  const retry=await rpc('v2_food_log_add_manual',food,aToken);
  assert.equal(retry.status,200,'Idempotent exact add retry failed');
  assert.equal((await retry.json()).replayed,true);
  const changed=await rpc('v2_food_log_add_manual',{
   ...food,p_kcal:301,
  },aToken);
  assert([400,409,422].includes(changed.status),'Changed idempotent replay was accepted');
  const reader=async(token,ownerId,date)=>rpc('v2_food_log_read_complete_day',{
   p_expected_user_id:ownerId,p_local_date:date,
  },token);
  const before=await reader(aToken,a.id,day);
  assert.equal(before.status,200,'Authorized Food Log day reader unavailable');
  const first=await before.json();
  assert.equal(first.complete,true);
  assert(first.sourceRevision?.startsWith('fuel-food-day-v1:'));
  assert.equal(first.entries?.length,1);
  assert.equal(first.entries[0]?.id,entryId);
  assert.equal(first.entries[0]?.user_id,a.id);
  const bDay=await reader(bToken,b.id,day);
  assert.equal(bDay.status,200,'Other owner cannot read own day');
  assert.equal((await bDay.json()).entries?.length,0,'A food leaked into B day');
  const deleted=await rpc('v2_food_log_mutate_manual',{
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:entryId,
   p_expected_revision:1,p_operation:'delete',
  },aToken);
  assert.equal(deleted.status,200,'Owner could not delete synthetic Food Log entry');
  const after=await reader(aToken,a.id,day);
  assert.equal(after.status,200,'Food Log day unavailable after delete');
  const final=await after.json();
  assert.equal(final.complete,true);
  assert.equal(final.entries?.length,0,'Deleted food was still visible');
  assert.notEqual(final.sourceRevision,first.sourceRevision,'Food Log revision not updated');
  process.stdout.write('PASS: hosted Food Log owner add/replay/read/delete; anon and foreign owner denied\n');
 }

 for(const token of [aToken,bToken]){
  const res=await request('/functions/v1/v2-account-export-download',{
    method:'POST',userJwt:token,apiKey:anon,body:{request_id:randomUUID()}});
  assert.equal(res.status,503,'Expected disabled staging export handler');
  const body=await res.json();
  assert.equal(body.code,'account_export_disabled');
  assert(/no-store/i.test(res.headers.get('cache-control')??''));
 }
 process.stdout.write('PASS: authenticated HTTP route rejects export while worker disabled\\n');
 const logout=await request('/auth/v1/logout',{method:'POST',userJwt:bToken,apiKey:anon});
 assert([200,204].includes(logout.status),'Auth logout failed');
 process.stdout.write('PASS: synthetic Auth session revoked\\n');
}catch{
 failed=true;process.stderr.write('FAIL: Auth/HTTP staging smoke; no tokens disclosed\\n');
}finally{
 for(const id of ids.reverse()){
  try{
   const res=await request('/auth/v1/admin/users/'+encodeURIComponent(id),{method:'DELETE'});
   assert([200,204].includes(res.status),'Cleanup rejected');
  }catch{
   failed=true;process.stderr.write('CLEANUP FAILED: staging Auth requires manual inspection\\n');
  }
 }
 if(!failed&&ids.length===2)process.stdout.write('PASS: two synthetic Auth users deleted\\n');
}
if(failed)process.exitCode=1;
