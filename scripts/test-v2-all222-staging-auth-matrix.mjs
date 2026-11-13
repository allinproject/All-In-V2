import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// ALL-222 temporary hosted staging-only tests. Invoked by ALL-251's existing
// protected two-account workflow, using its genuine GoTrue bearer tokens.
// No privileged token is logged or used to authorize a client RPC.
const denied = new Set([400, 401, 403]);
const unavailable = new Set([400, 401, 403, 404]);
function expectRestricted(response, label) {
  assert(unavailable.has(response.status), label + ': unexpectedly allowed HTTP ' + response.status);
}
function expectDenied(response, label) {
  assert(denied.has(response.status), label + ': unexpectedly allowed HTTP ' + response.status);
}
function expectOK(response, label) {
  assert.equal(response.status, 200, label + ': HTTP status mismatch');
}
export async function runAll222AuthMatrix({request, a, b, aToken, bToken, anon}) {
  const rpc = (name, body, token=null) => request('/rest/v1/rpc/' + name, {
    method:'POST', body, userJwt:token, apiKey:anon,
  });
  const ownA = {p_expected_user_id:a.id};
  const ownB = {p_expected_user_id:b.id};
  // 1. Profile: no expected-user argument; identity comes from validated JWT.
  const aProfile=await rpc('v2_my_profile_state',{},aToken);
  expectOK(aProfile,'A own profile read');
  const aData=await aProfile.json();
  assert.equal(aData.profile?.user_id,a.id,'A profile identity mismatch');
  const bProfile=await rpc('v2_my_profile_state',{},bToken);
  expectOK(bProfile,'B own profile read');
  const bData=await bProfile.json();
  assert.equal(bData.profile?.user_id,b.id,'B profile identity mismatch');
  expectDenied(await rpc('v2_my_profile_state',{}),'Anonymous profile read');

  // This harness runs AFTER the existing Profile/Onboarding/Training acceptance.
  // Use current versions rather than assuming new accounts still have v1.
  const preMatrix=await rpc('v2_my_profile_state',{},aToken);
  expectOK(preMatrix,'A before extended RPC matrix');
  const currentState=await preMatrix.json();
  const settingsVersion=currentState.settings?.version;
  const onboardingVersion=currentState.onboarding?.version;
  assert(Number.isInteger(settingsVersion)&&settingsVersion>0,'Missing Settings version');
  assert(Number.isInteger(onboardingVersion)&&onboardingVersion>0,'Missing Onboarding version');
  // 2. Settings: A success, B attempted A and stale A screen under B JWT denied.
  const settingArgs={...ownA,p_section:'app_preferences',
    p_patch:{all222_ephemeral:'test'},p_expected_version:settingsVersion,
    p_client_action_id:'all222-settings-'+randomUUID()};
  expectDenied(await rpc('v2_patch_profile_settings_section',settingArgs,bToken),
    'B-to-A settings mutation');
  expectDenied(await rpc('v2_patch_profile_settings_section',settingArgs),
    'Anonymous settings mutation');
  const setA=await rpc('v2_patch_profile_settings_section',settingArgs,aToken);
  expectOK(setA,'A own settings mutation');
  assert.equal(await setA.json(),settingsVersion+1,'A settings did not increment version');

  // 3. Onboarding: B-to-A and replayed A screen after account switch rejected.
  const stepArgs={...ownA,p_step:'coach',p_action:'complete',p_expected_version:onboardingVersion,
    p_client_action_id:'all222-onboard-'+randomUUID()};
  expectDenied(await rpc('v2_set_onboarding_step',stepArgs,bToken),
    'B-to-A onboarding mutation');
  expectDenied(await rpc('v2_set_onboarding_step',stepArgs),
    'Anonymous onboarding mutation');
  const onboardA=await rpc('v2_set_onboarding_step',stepArgs,aToken);
  expectOK(onboardA,'A own onboarding mutation');
  assert.equal(await onboardA.json(),onboardingVersion+1,'A onboarding did not increment version');

  // 4 & 5. Health read/write: A owns a private record, B never sees or alters A.
  const healthBefore=await rpc('v2_my_health_considerations',ownA,aToken);
  expectOK(healthBefore,'A baseline Health read');
  assert.equal((await healthBefore.json()).version,0);
  expectDenied(await rpc('v2_my_health_considerations',ownA,bToken),
    'B-to-A Health read');
  expectDenied(await rpc('v2_my_health_considerations',ownA),
    'Anonymous Health read');
  const healthArgs={...ownA,p_conditions:[],p_limitations:[],
    p_coach_opt_in:false,p_expected_version:0};
  expectDenied(await rpc('v2_save_health_considerations',healthArgs,bToken),
    'B-to-A Health write');
  const savedHealth=await rpc('v2_save_health_considerations',healthArgs,aToken);
  expectOK(savedHealth,'A own Health write');
  assert.equal(await savedHealth.json(),1,'A Health version mismatch');
  const bHealth=await rpc('v2_my_health_considerations',ownB,bToken);
  expectOK(bHealth,'B separate Health read');
  assert.equal((await bHealth.json()).version,0,'A Health leaked into B');

  // 6. Legal: no approved/published text in temporary staging. Owner must fail
  // closed for missing documents; a foreign account must fail for ownership.
  const legal={...ownA,p_terms_version:'not-published',
    p_privacy_version:'not-published',
    p_founder_beta_terms_version:'not-published',
    p_age_18_confirmed:true,p_client_action_id:'all222-legal-'+randomUUID()};
  expectDenied(await rpc('v2_accept_legal_documents',legal,bToken),
    'B-to-A legal receipt');
  expectDenied(await rpc('v2_accept_legal_documents',legal,aToken),
    'Unpublished legal text must not be accepted');
  expectDenied(await rpc('v2_accept_legal_documents',legal),
    'Anonymous legal receipt');

  // 7. Snapshot: incomplete private Storage and new owner-data domains must
  // fail closed even for the correct account. Never treat this as full export.
  expectDenied(await rpc('v2_export_my_account_snapshot',ownA,bToken),
    'B-to-A snapshot');
  expectDenied(await rpc('v2_export_my_account_snapshot',ownA,aToken),
    'Incomplete owner snapshot should fail closed');
  expectDenied(await rpc('v2_export_my_account_snapshot',ownA),
    'Anonymous snapshot');

  // 8-10. ALL-251 intentionally removed authenticated deletion API grants in
  // this temporary staging environment. Test denial; do not grant to pass.
  expectRestricted(await rpc('v2_request_account_deletion',
    {...ownA,p_confirm:'DELETE MY ACCOUNT'},aToken),
    'Deletion intake intentionally disabled in temporary staging');
  expectRestricted(await rpc('v2_my_account_deletion_request',ownA,aToken),
    'Deletion status intentionally disabled in temporary staging');
  expectRestricted(await rpc('v2_cancel_account_deletion_request',
    {...ownA,p_expected_request_id:randomUUID()},aToken),
    'Deletion cancel intentionally disabled in temporary staging');

  // Auth switch: current bearer is B, old screen still passes captured A ID.
  for(const [name,body] of [
    ['v2_patch_profile_settings_section',{...settingArgs,
      p_client_action_id:'all222-switch-settings-'+randomUUID()}],
    ['v2_set_onboarding_step',{...stepArgs,
      p_client_action_id:'all222-switch-onboard-'+randomUUID()}],
    ['v2_my_health_considerations',ownA],
    ['v2_save_health_considerations',healthArgs],
    ['v2_accept_legal_documents',legal],
    ['v2_export_my_account_snapshot',ownA],
  ]) {
    expectDenied(await rpc(name,body,bToken),
      'Stale A screen under switched B session: ' + name);
  }
  // Read-back under both genuine JWTs proves failed B requests did not alter A.
  const rereadA=await rpc('v2_my_profile_state',{},aToken);
  expectOK(rereadA,'A post-denial profile read');
  const state=await rereadA.json();
  assert.equal(state.settings?.version,settingsVersion+1,'A settings changed unexpectedly');
  assert.equal(state.onboarding?.version,onboardingVersion+1,'A onboarding changed unexpectedly');
  const healthAfter=await rpc('v2_my_health_considerations',ownA,aToken);
  expectOK(healthAfter,'A post-denial Health read');
  assert.equal((await healthAfter.json()).version,1,
    'A Health changed unexpectedly');
  process.stdout.write('PASS ALL-222: real A/B Profile, Settings, Onboarding, Health, Legal/export fail-closed, cross-owner and stale-screen denial\n');
  process.stdout.write('PASS ALL-222: three ALL-251 deletion APIs remain non-executable in protected staging\n');
}

export async function checkAll222RevokedToken({request,bToken,anon}) {
  const rpc=async(name,body)=>request('/rest/v1/rpc/'+name,{
    method:'POST',body,userJwt:bToken,apiKey:anon,
  });
  const check=async(label,name,body)=>{
    const res=await rpc(name,body);
    if(!denied.has(res.status)){
      let state='unknown';
      try {
        const payload=await res.clone().json();
        if(typeof payload?.code==='string' && /^[A-Z0-9_]{3,24}$/.test(payload.code))
          state=payload.code;
      }catch{}
      process.stderr.write('ALL222 signed-out '+label+' HTTP '+res.status+
        ' SQLSTATE '+state+' (no response bodies or identifiers)\\n');
    }
    expectDenied(res,'Revoked B token still accesses '+label);
  };
  // A JWT can remain cryptographically valid after sign-out; these owner RPCs
  // must query the live GoTrue session row and deny a revoked token immediately.
  await check('Profile RPC','v2_my_profile_state',{});
  await check('Training day RPC','v2_training_day_read_candidate',{
    p_expected_user_id:JSON.parse(Buffer.from(bToken.split('.')[1],'base64url').toString()).sub,
    p_athlete_date:new Date().toISOString().slice(0,10),
  });
  process.stdout.write('PASS ALL-222: revoked B token denied by both Profile and Training owner readers\\n');
}
