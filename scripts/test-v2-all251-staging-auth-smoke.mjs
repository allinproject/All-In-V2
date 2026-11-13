
import assert from 'node:assert/strict';
import {runAll222AuthMatrix,checkAll222RevokedToken} from './test-v2-all222-staging-auth-matrix.mjs';
import {randomUUID} from 'node:crypto';
import {verifyAccountExportDownload} from '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';
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
const temporaryStoragePaths=[];
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
let approvedRequestId=null;
// Fixed checkpoint names reveal the failing assertion without tokens, IDs or bodies.
let acceptanceStep='setup';
try{
 acceptanceStep='synthetic Auth creation';
 const a=await user(),b=await user();
 acceptanceStep='synthetic Auth login';
 const aToken=await login(a),bToken=await login(b);
 assert.notEqual(aToken,bToken);

 // ALL222 canonical Profile Onboarding Training acceptance.
 // Real GoTrue sessions only; no role injection, SQL login, mock tokens or client table writes.
 const all222Rpc=(name,body,token)=>request('/rest/v1/rpc/'+name,{
   method:'POST',body,userJwt:token,apiKey:anon,
 });
 const all222Denied=res=>assert([400,401,403].includes(res.status),
   'Cross-owner RPC unexpectedly authorized');
 acceptanceStep='ALL222 canonical owner snapshot before writes';
 const initialResponse=await all222Rpc('v2_my_profile_state',{},aToken);
 assert.equal(initialResponse.status,200,'Owner A initial profile snapshot unavailable');
 const initial=await initialResponse.json();
 assert.equal(initial.profile?.user_id,a.id,'Profile owner mismatch');
 assert(Number.isInteger(initial.settings?.version),'Profile version missing');
 assert(Number.isInteger(initial.onboarding?.version),'Onboarding version missing');
 acceptanceStep='ALL222 Profile settings real Auth write';
 const profileWrite=await all222Rpc('v2_patch_profile_settings_section',{
   p_expected_user_id:a.id,p_section:'training_preferences',
   p_patch:{all222_staging_verified:'real-auth'},
   p_expected_version:initial.settings.version,p_client_action_id:randomUUID(),
 },aToken);
 assert.equal(profileWrite.status,200,'Canonical Profile settings write denied');
 const profileVersion=await profileWrite.json();
 assert.equal(profileVersion,initial.settings.version+1);
 acceptanceStep='ALL222 Profile settings authenticated readback';
 const profileRead=await all222Rpc('v2_my_profile_state',{},aToken);
 assert.equal(profileRead.status,200,'Profile readback failed');
 const ownerProfile=await profileRead.json();
 assert.equal(ownerProfile.settings?.version,profileVersion);
 assert.equal(ownerProfile.settings?.settings?.training_preferences?.all222_staging_verified,'real-auth');
 acceptanceStep='ALL222 onboarding real Auth write';
 const onboardingWrite=await all222Rpc('v2_set_onboarding_step',{
   p_expected_user_id:a.id,p_step:'focus',p_action:'complete',
   p_expected_version:initial.onboarding.version,p_client_action_id:randomUUID(),
 },aToken);
 assert.equal(onboardingWrite.status,200,'Canonical onboarding writer denied');
 const onboardingVersion=await onboardingWrite.json();
 assert.equal(onboardingVersion,initial.onboarding.version+1);
 acceptanceStep='ALL222 onboarding authenticated readback';
 const onboardingRead=await all222Rpc('v2_my_profile_state',{},aToken);
 assert.equal(onboardingRead.status,200,'Onboarding readback failed');
 const ownerOnboarding=await onboardingRead.json();
 assert.equal(ownerOnboarding.onboarding?.version,onboardingVersion);
 assert(ownerOnboarding.onboarding?.completed_steps?.includes('focus'));
 acceptanceStep='ALL222 canonical Training real Auth start';
 const all222Session=randomUUID(),all222Action=randomUUID();
 const all222Date=new Date().toISOString().slice(0,10);
 const started=await all222Rpc('v2_training_session_action_candidate',{
   p_expected_user_id:a.id,p_session_id:all222Session,
   p_action_id:all222Action,p_command:'start',p_expected_version:0,
   p_request_fingerprint:'not_trusted_server_recomputes',
   p_local_date:all222Date,p_timezone:'America/Chicago',
   p_occurred_at:new Date().toISOString(),
 },aToken);
 if(started.status!==200){
   let safeErrorCode='unknown';
   try{
     const errorBody=await started.clone().json();
     if(typeof errorBody?.code==='string'&&/^[A-Z0-9_]{3,24}$/.test(errorBody.code))
       safeErrorCode=errorBody.code;
   }catch{}
   process.stderr.write('ALL222 Training start HTTP '+started.status+
     ' SQLSTATE '+safeErrorCode+' (no response body, credentials or identifiers)\\n');
 }
 assert.equal(started.status,200,'Authenticated Training start rejected');
 const trainingResult=await started.json();
 assert.equal(trainingResult.sessionId,all222Session);
 assert.equal(trainingResult.version,1);
 assert.equal(trainingResult.status,'active');
 acceptanceStep='ALL222 Training owner day readback';
 const trainingRead=await all222Rpc('v2_training_day_read_candidate',{
   p_expected_user_id:a.id,p_athlete_date:all222Date,
 },aToken);
 assert.equal(trainingRead.status,200,'Training owner reader rejected');
 const trainingState=await trainingRead.json();
 assert.equal(trainingState.ownerId,a.id);
 assert.equal(trainingState.liveWorkout?.executionId,all222Session);
 assert.equal(trainingState.liveWorkout?.status,'active');
 acceptanceStep='ALL222 cross-account owner boundary';
 const bProfile=await all222Rpc('v2_my_profile_state',{},bToken);
 assert.equal(bProfile.status,200,'B cannot access own Profile');
 const bSnapshot=await bProfile.json();
 assert.notEqual(bSnapshot.settings?.settings?.training_preferences?.all222_staging_verified,'real-auth');
 assert(!bSnapshot.onboarding?.completed_steps?.includes('focus'),'A onboarding leaked to B');
 const bDay=await all222Rpc('v2_training_day_read_candidate',{
   p_expected_user_id:b.id,p_athlete_date:all222Date,
 },bToken);
 assert.equal(bDay.status,200,'B cannot access own Training day');
 assert.equal((await bDay.json()).liveWorkout,null,'A Training leaked into B');
 all222Denied(await all222Rpc('v2_training_day_read_candidate',{
   p_expected_user_id:a.id,p_athlete_date:all222Date,
 },bToken));
 all222Denied(await all222Rpc('v2_patch_profile_settings_section',{
   p_expected_user_id:a.id,p_section:'training_preferences',
   p_patch:{all222_staging_verified:'foreign'},
   p_expected_version:profileVersion,p_client_action_id:randomUUID(),
 },bToken));
 all222Denied(await all222Rpc('v2_set_onboarding_step',{
   p_expected_user_id:a.id,p_step:'coach',p_action:'skip',
   p_expected_version:onboardingVersion,p_client_action_id:randomUUID(),
 },bToken));
 all222Denied(await all222Rpc('v2_training_session_action_candidate',{
   p_expected_user_id:a.id,p_session_id:all222Session,
   p_action_id:randomUUID(),p_command:'pause',p_expected_version:1,
   p_request_fingerprint:'untrusted',p_local_date:all222Date,
   p_timezone:'America/Chicago',p_occurred_at:new Date().toISOString(),
 },bToken));
 acceptanceStep='ALL222 post-foreign-denial owner state preserved';
 const preserved=await all222Rpc('v2_training_day_read_candidate',{
   p_expected_user_id:a.id,p_athlete_date:all222Date,
 },aToken);
 assert.equal(preserved.status,200);
 assert.equal((await preserved.json()).liveWorkout?.status,'active');
 process.stdout.write('PASS: ALL222 genuine Auth A Profile, Onboarding, Training writes and readbacks; B isolated and denied\\n');
 acceptanceStep='synthetic Auth invalid password rejection';
 for(const u of [a,b]){
   const denied=await request('/auth/v1/token?grant_type=password',{
     method:'POST',apiKey:anon,
     body:{email:u.email,password:randomUUID()+'Wrong!9'},
   });
   assert([400,401,403].includes(denied.status),'Invalid password unexpectedly authenticated');
 }
 process.stdout.write('PASS: invalid passwords rejected for both synthetic owners\\n');
 process.stdout.write('PASS: two real isolated synthetic GoTrue sessions\\n');
 if(env.ALL222_STAGING_AUTH_MATRIX_ALLOW==='true') {
   acceptanceStep='ALL-222 genuine two-account authenticated RPC matrix';
   await runAll222AuthMatrix({request,a,b,aToken,bToken,anon});
 }
 // Storage byte upload/readback belongs to the separately guarded,
 // lease-aware ALL-251 acceptance. This general Auth smoke must instead
 // prove that even the protected staging secret cannot upload without a
 // durable owner-scoped write lease. Never weaken the existing fence.
 acceptanceStep='hosted private Storage unleased upload denial';
 const bucket='v2-private-workout-objects';
 const objectPath=a.id+'/all251-unleased-'+randomUUID()+'.bin';
 const storagePath='/storage/v1/object/'+bucket+'/'+objectPath;
 const upload=await fetch(base+storagePath,{
   method:'POST',headers:{apikey:key,'content-type':'application/octet-stream'},
   body:Buffer.from('ALL251 unauthorized synthetic upload probe'),
   redirect:'manual',signal:AbortSignal.timeout(30000),
 });
 // Protect cleanup if a regression unexpectedly allows creation.
 if([200,201].includes(upload.status))temporaryStoragePaths.push(storagePath);
 assert([400,403].includes(upload.status),
   'Unleased privileged Storage upload was not denied');
 const readback=await fetch(base+'/storage/v1/object/authenticated/'+bucket+'/'+objectPath,{
   method:'GET',headers:{apikey:key},
   redirect:'manual',signal:AbortSignal.timeout(30000),
 });
 assert([400,404].includes(readback.status),
   'Unleased upload unexpectedly left readable private Storage bytes');
 process.stdout.write('PASS: hosted unleased privileged Storage upload denied; no object readable\\n');
 // The canonical restricted RPC bridges must never trust a signed-in user
 // directly or authorize an unapproved request, even through a secret-key
 // backend. Verify against real hosted Auth user and session identifiers.
 const sessionId=JSON.parse(Buffer.from(aToken.split('.')[1],'base64url').toString()).session_id;
 assert(/^[a-f0-9-]{36}$/i.test(sessionId??''),'Missing real Auth session claim');
 const args={p_user_id:a.id,p_session_id:sessionId,p_request_id:randomUUID()};
 acceptanceStep='restricted export authorization';
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
 acceptanceStep='optional ALL251 approved request';
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
  approvedRequestId=opened.requestId;
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


 acceptanceStep='ALL247 anonymous owner-reader denial';
 if(env.ALL247_TEST_FOOD_RPC==='true'){
  // ALL-247 single canonical Food Log, tested with genuine Auth JWTs against
  // the installed TEMPORARY staging schema only. No other project permitted.
  // Print ONLY the RPC identifier, HTTP status and a fixed checkpoint label.
  // Never print JWTs, user IDs, request payloads, or response bodies.
  const rpc=async(name,body,token=null)=>{
   const result=await request('/rest/v1/rpc/'+name,{
    method:'POST',body,userJwt:token,apiKey:anon,
   });
   process.stdout.write('ALL247 HTTP '+name+' status='+result.status+'\n');
   return result;
  };
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
  acceptanceStep='ALL247 foreign owner-reader denial';
  const foreign=await rpc('v2_food_log_read_complete_day',{
   p_expected_user_id:a.id,p_local_date:day,
  },bToken);
  assert([400,401,403].includes(foreign.status),'Other owner accessed Food Log');
  acceptanceStep='ALL247 owner food add';
  const addition=await rpc('v2_food_log_add_manual',food,aToken);
  assert.equal(addition.status,200,'Owner could not add food via real RPC');
  const added=await addition.json();
  assert.equal(added.id,entryId);
  assert.equal(added.revision,1);
  process.stdout.write('ALL247 owner add shape passed\n');
  acceptanceStep='ALL247 exact add replay';
  const retry=await rpc('v2_food_log_add_manual',food,aToken);
  assert.equal(retry.status,200,'Idempotent exact add retry failed');
  assert.equal((await retry.json()).replayed,true);
  process.stdout.write('ALL247 exact retry shape passed\n');
  acceptanceStep='ALL247 changed-payload replay denial';
  const changed=await rpc('v2_food_log_add_manual',{
   ...food,p_kcal:301,
  },aToken);
  assert([400,409,422].includes(changed.status),'Changed idempotent replay was accepted');
  const reader=async(token,ownerId,date)=>rpc('v2_food_log_read_complete_day',{
   p_expected_user_id:ownerId,p_local_date:date,
  },token);
  acceptanceStep='ALL247 complete owner-day read';
  const before=await reader(aToken,a.id,day);
  assert.equal(before.status,200,'Authorized Food Log day reader unavailable');
  const first=await before.json();
  assert.equal(first.complete,true);
  assert(first.sourceRevision?.startsWith('fuel-food-day-v1:'));
  assert.equal(first.entries?.length,1);
  assert.equal(first.entries[0]?.id,entryId);
  assert.equal(first.entries[0]?.user_id,a.id);
  // The mounted Fuel editor requires the complete original portion, source,
  // and time zone, never a guessed 1 serving or zero-calorie replacement.
  assert.equal(first.entries[0]?.quantity,1);
  assert.equal(first.entries[0]?.unit,'serving');
  assert.equal(first.entries[0]?.kcal,300);
  assert.equal(first.entries[0]?.nutrition_source,'user_entered');
  assert.equal(first.entries[0]?.timezone_name,'America/Chicago');
  process.stdout.write('ALL247 own-day output passed\n');
  acceptanceStep='ALL247 second-owner empty day';
  const bDay=await reader(bToken,b.id,day);
  assert.equal(bDay.status,200,'Other owner cannot read own day');
  assert.equal((await bDay.json()).entries?.length,0,'A food leaked into B day');
  acceptanceStep='ALL247 edit food';
  const edited=await rpc('v2_food_log_mutate_manual',{
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:entryId,
   p_expected_revision:1,p_operation:'edit',
   p_consumed_at:food.p_consumed_at,p_local_date:day,
   p_timezone_name:food.p_timezone_name,p_meal_slot:food.p_meal_slot,
   p_label:'ALL247 edited food',p_quantity:1,p_unit:'serving',
   p_kcal:350,p_nutrition_source:'user_entered',
  },aToken);
  assert.equal(edited.status,200,'Authorized food edit rejected');
  assert.equal((await edited.json()).revision,2,'Edit did not advance revision');
  const afterEdit=await reader(aToken,a.id,day);
  assert.equal(afterEdit.status,200,'Edited food day unavailable');
  const editSnapshot=await afterEdit.json();
  assert.equal(editSnapshot.entries?.[0]?.label,'ALL247 edited food');
  assert.equal(editSnapshot.entries?.[0]?.kcal,350);
  assert.equal(editSnapshot.entries?.[0]?.nutrition_source,'user_entered');
  assert.notEqual(editSnapshot.sourceRevision,first.sourceRevision,'Edit revision unchanged');

  acceptanceStep='ALL247 stale edit denial';
  const stale=await rpc('v2_food_log_mutate_manual',{
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:entryId,
   p_expected_revision:1,p_operation:'delete',
  },aToken);
  assert.equal(stale.status,409,'Stale revision must fail promptly with HTTP 409');

  acceptanceStep='ALL247 cross-account deletion denial';
  const foreignDelete=await rpc('v2_food_log_mutate_manual',{
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:entryId,
   p_expected_revision:2,p_operation:'delete',
  },bToken);
  assert([400,401,403].includes(foreignDelete.status),'Other account deleted owner food');

  acceptanceStep='ALL247 move meal to another day';
  const movedDay='2026-11-13';
  const moveActionId=randomUUID();
  const moveArgs={
   p_expected_user_id:a.id,p_action_id:moveActionId,p_entry_id:entryId,
   p_expected_revision:2,p_operation:'move',
   p_consumed_at:'2026-11-13T18:00:00Z',p_local_date:movedDay,
   p_timezone_name:'America/Chicago',p_meal_slot:'dinner',
   p_label:'ALL247 edited food',p_quantity:1,p_unit:'serving',
   p_kcal:350,p_nutrition_source:'user_entered',
  };
  const moved=await rpc('v2_food_log_mutate_manual',moveArgs,aToken);
  assert.equal(moved.status,200,'Authorized meal move rejected');
  assert.equal((await moved.json()).revision,3,'Move did not advance revision');
  const movedRetry=await rpc('v2_food_log_mutate_manual',moveArgs,aToken);
  assert.equal(movedRetry.status,200,'Exact move retry was rejected');
  assert.equal((await movedRetry.json()).replayed,true,'Move retry re-applied action');
  const oldDay=await reader(aToken,a.id,day);
  assert.equal(oldDay.status,200,'Original Food day read failed after move');
  const oldSnapshot=await oldDay.json();
  assert.equal(oldSnapshot.entries?.length,0,'Meal retained on old date');
  const newDay=await reader(aToken,a.id,movedDay);
  assert.equal(newDay.status,200,'New Food day read failed after move');
  const newSnapshot=await newDay.json();
  assert.equal(newSnapshot.entries?.length,1,'Moved meal not present on new date');
  assert.equal(newSnapshot.entries[0].revision,3);
  assert.equal(newSnapshot.entries[0].meal_slot,'dinner');
  assert.notEqual(oldSnapshot.sourceRevision,first.sourceRevision,'Old date did not change');

  acceptanceStep='ALL247 owner delete and exact replay';
  const deleteArgs={
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:entryId,
   p_expected_revision:3,p_operation:'delete',
  };
  const deleted=await rpc('v2_food_log_mutate_manual',deleteArgs,aToken);
  assert.equal(deleted.status,200,'Owner could not delete synthetic Food Log entry');
  assert.equal((await deleted.json()).revision,4,'Delete did not advance revision');
  const deleteRetry=await rpc('v2_food_log_mutate_manual',deleteArgs,aToken);
  assert.equal(deleteRetry.status,200,'Exact delete retry not accepted');
  assert.equal((await deleteRetry.json()).replayed,true,'Delete retry re-applied');
  acceptanceStep='ALL247 post-delete day read';
  const after=await reader(aToken,a.id,movedDay);
  assert.equal(after.status,200,'Food Log day unavailable after delete');
  const final=await after.json();
  assert.equal(final.complete,true);
  assert.equal(final.entries?.length,0,'Deleted food was still visible');
  assert.notEqual(final.sourceRevision,newSnapshot.sourceRevision,'Food Log revision not updated');
  acceptanceStep='ALL247 simultaneous same-revision edit race';
  // Two independent authenticated HTTP requests compete for one event at
  // revision 1. Exactly one wins; both may NOT commit or overwrite the winner.
  const raceId=randomUUID();
  const raceAdd=await rpc('v2_food_log_add_manual',{
   ...food,p_action_id:randomUUID(),p_entry_id:raceId,p_label:'Race original',
  },aToken);
  assert.equal(raceAdd.status,200,'Could not seed concurrency test');
  const raceReplace=label=>({
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:raceId,
   p_expected_revision:1,p_operation:'edit',p_consumed_at:food.p_consumed_at,
   p_local_date:day,p_timezone_name:food.p_timezone_name,
   p_meal_slot:'lunch',p_label:label,p_quantity:1,p_unit:'serving',
   p_kcal:300,p_nutrition_source:'user_entered',
  });
  const [raceOne,raceTwo]=await Promise.all([
   rpc('v2_food_log_mutate_manual',raceReplace('First candidate'),aToken),
   rpc('v2_food_log_mutate_manual',raceReplace('Second candidate'),aToken),
  ]);
  const raceStatuses=[raceOne.status,raceTwo.status].sort((x,y)=>x-y);
  assert.deepEqual(raceStatuses,[200,409],
    'Concurrent revision-1 edits must yield one success and one conflict');
  const raceRead=await reader(aToken,a.id,day);
  assert.equal(raceRead.status,200,'Owner could not read concurrent winner');
  const raceState=await raceRead.json();
  assert.equal(raceState.entries?.length,1,'Unexpected concurrent Food row count');
  assert.equal(raceState.entries[0]?.revision,2,'Concurrent edit did not advance once');
  assert(['First candidate','Second candidate'].includes(raceState.entries[0]?.label),
    'Concurrent winner data was lost');
  const raceCleanup=await rpc('v2_food_log_mutate_manual',{
   p_expected_user_id:a.id,p_action_id:randomUUID(),p_entry_id:raceId,
   p_expected_revision:2,p_operation:'delete',
  },aToken);
  assert.equal(raceCleanup.status,200,'Race fixture tombstone failed');
  process.stdout.write('PASS: concurrent Food Log edits serialize; exactly one 200, one 409, winner preserved\n');
  process.stdout.write('PASS: hosted Food Log add/edit/move/delete; revisions, replay, both days and owner isolation\n');
 }

 // The same ephemeral JWTs are used for the eventual approved positive
 // download. No persistent token secrets, parallel export store or synthetic
 // complete=true inventory. This switch MUST stay OFF until the actual KMS
 // lease, canonical pinned source inventory and private archive are accepted.
 const positive=env.ALL251_TEST_REAL_HTTP_DOWNLOAD==='true';
 if(positive&&(!approvedRequestId||env.ALL251_TEST_REAL_APPROVAL!=='true'))
  throw Error('Real HTTP acceptance requires a durably approved owner request');
 const download=token=>request('/functions/v1/v2-account-export-download',{
  method:'POST',userJwt:token,apiKey:anon,
  body:{request_id:approvedRequestId??randomUUID()},
 });
 if(positive){
  acceptanceStep='ALL251 B cross-owner download denial';
  const foreign=await download(bToken);
  assert([400,401,403].includes(foreign.status),
   'Foreign Auth session reached owner export');
  assert(/no-store/i.test(foreign.headers.get('cache-control')??''));
  acceptanceStep='ALL251 approved owner download';
  const ownerResponse=await download(aToken);
  assert.equal(ownerResponse.status,200,'Approved owner did not receive export');
  assert(/^application\/x-ndjson/i.test(ownerResponse.headers.get('content-type')??''));
  assert(/no-store/i.test(ownerResponse.headers.get('cache-control')??''));
  assert.equal(ownerResponse.headers.get('access-control-allow-origin'),null);
  assert(ownerResponse.body,'No owner archive stream');
  const expected=JSON.parse(env.ALL251_EXPECTED_COLLECTIONS_JSON??'null');
  assert(Array.isArray(expected)&&expected.length>0&&expected.length<=64
   &&new Set(expected).size===expected.length
   &&expected.every(x=>typeof x==='string'&&/^[a-z][a-z0-9_.]{0,63}$/.test(x)),
   'Missing reviewed canonical collection list');
  const verified=await verifyAccountExportDownload({
   stream:ownerResponse.body,expectedOwnerId:a.id,expectedCollections:expected,
  });
  assert.equal(verified.verified,true,'Owner export stream integrity rejected');
  assert(verified.recordCount>0,'Representative owner archive is empty');
  process.stdout.write('PASS: real authenticated owner HTTP archive digest and collection scope\\n');
 }else{
  acceptanceStep='ALL251 disabled download route';
  for(const token of [aToken,bToken]){
   const res=await request('/functions/v1/v2-account-export-download',{
    method:'POST',userJwt:token,apiKey:anon,body:{request_id:randomUUID()}});
   assert.equal(res.status,503,'Expected disabled staging export handler');
   const body=await res.json();
   assert.equal(body.code,'account_export_disabled');
   assert(/no-store/i.test(res.headers.get('cache-control')??''));
  }
  process.stdout.write('PASS: authenticated HTTP route rejects export while worker disabled\\n');
 }
 acceptanceStep='synthetic Auth logout';
 const logout=await request('/auth/v1/logout',{method:'POST',userJwt:bToken,apiKey:anon});
 assert([200,204].includes(logout.status),'Auth logout failed');
 process.stdout.write('PASS: synthetic Auth session revoked\\n');
 if(env.ALL222_STAGING_AUTH_MATRIX_ALLOW==='true') {
   acceptanceStep='ALL-222 revoked access token rejection';
   await checkAll222RevokedToken({request,bToken,anon});
 }
 if(positive){
  acceptanceStep='ALL251 revoked session download denial';
  const revoked=await download(bToken);
  assert([400,401,403].includes(revoked.status),
   'Revoked Auth session reached owner export');
  assert(/no-store/i.test(revoked.headers.get('cache-control')??''));
  process.stdout.write('PASS: active B and revoked B denied owner archive\\n');
 }
}catch{
 failed=true;
 process.stderr.write('FAIL staging checkpoint: '+acceptanceStep+' (no credentials or response data disclosed)\\n');
}finally{
 for(const path of temporaryStoragePaths.reverse()){
   try{
     const res=await fetch(base+path,{method:'DELETE',redirect:'manual',
       signal:AbortSignal.timeout(30000),headers:{apikey:key}});
     assert([200,204].includes(res.status),'Staging byte-fixture cleanup rejected');
     // Storage delete ACK is not proof of removal: check real hosted bytes
     // cannot be fetched by the privileged test identity after cleanup.
     const readback=await fetch(base+path.replace('/object/','/object/authenticated/'),{
       method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000),
       headers:{apikey:key},
     });
     assert([400,404].includes(readback.status),
       'Staging object bytes remained readable after deletion');
   }catch{
     failed=true;process.stderr.write('CLEANUP FAILED: temporary staging Storage object requires inspection\\n');
   }
 }
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
