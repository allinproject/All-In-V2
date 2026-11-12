'use strict';
// ALL-222 / ALL-228: trusted server gateway preflight to the existing private
// ingredient writer candidate. Pure command preparation: NO SQL/network here.
// Caller MUST supply verifier implemented with Supabase Auth getUser(token),
// not JWT decode, user_metadata, app_metadata, or client-supplied actor ID.
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ENERGY='usda-fdc-energy-specific-legacy-v1';
const NUTRIENTS='cookbook-launch-macros-v1';
const validUuid=v=>typeof v==='string'&&UUID.test(v);
function stableCanonical(value) {
  if(Array.isArray(value))return '['+value.map(stableCanonical).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableCanonical(value[k])).join(',')+'}';
  }
  return JSON.stringify(value);
}
/**
 * Build a server-only candidate writer command. This function deliberately
 * does NOT grant SQL permissions, publish or mutate profile records.
 * The PostgreSQL owner function independently checks active reviewer
 * authorization, revision CAS, source link, completeness and audit.
 */
async function buildReviewCommand(request,dependencies){
  const deny=(code)=>({status:'denied',reason:code,writerCommand:null});
  if(!request||!dependencies||
     typeof dependencies.verifyAccessToken!=='function'||
     typeof dependencies.findReviewerAuthorization!=='function'||
     typeof dependencies.loadAuthoritativeReview!=='function')
    return deny('trusted_gateway_dependencies_required');
  const token=request.bearerToken;
  if(typeof token!=='string'||token.length<20||token.length>8192)
    return deny('verified_bearer_required');
  if(request.action!=='review'||!validUuid(request.actionId)||
     !validUuid(request.profileId)||!validUuid(request.sourceRecordId)||
     !Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<1||
     typeof request.sourceProfileKey!=='string'||!request.sourceProfileKey.trim())
    return deny('invalid_command_or_release_gate');
  let user,authorization,source;
  try {
    user=await dependencies.verifyAccessToken(token); // Supabase Auth getUser(token)
    if(!user||!validUuid(user.id))return deny('verified_user_required');
    authorization=await dependencies.findReviewerAuthorization(user.id);
    if(!authorization||authorization.user_id!==user.id||
       authorization.enabled!==true||
       !['reviewer','publisher'].includes(authorization.capability)||
       !Number.isFinite(Date.parse(authorization.expires_at))||
       Date.parse(authorization.expires_at)<=Date.now()||
       !validUuid(authorization.approved_by)||
       authorization.approved_by===user.id)
      return deny('active_independently_approved_reviewer_required');
    source=await dependencies.loadAuthoritativeReview(request.sourceProfileKey,request.sourceRecordId);
  }catch(_e) {return deny('authentication_or_authoritative_read_failed')}
  if(!source||source.ownerReviewStatus!=='review_stage_complete'||
     source.authorizedToWrite!==false||source.calculationReady!==false||
     source.publicationApproved!==false||source.profileReviewStatus!=='needs_review'||
     source.profileId!==request.profileId||
     source.sourceRecordId!==request.sourceRecordId||
     source.sourceProfileKey!==request.sourceProfileKey||
     !SHA.test(source.sourcePayloadSha256)||
     source.energyPolicyVersion!==ENERGY||
     source.nutrientSetVersion!==NUTRIENTS||
     !source.sourceFacts||typeof source.sourceFacts!=='object'||
     !['atwater_specific','legacy_energy'].includes(source.energyMethod))
    return deny('canonical_source_and_nutrient_review_required');
  const core=['energy_kcal','protein_g','carbohydrate_g','total_fat_g','sodium_mg'];
  if(core.some(k=>typeof source.sourceFacts[k]!=='number'||
       !Number.isFinite(source.sourceFacts[k])||source.sourceFacts[k]<0))
    return deny('incomplete_launch_nutrients');
  const evidence=stableCanonical({
    energyPolicyVersion:ENERGY,nutrientSetVersion:NUTRIENTS,
    sourceProfileKey:source.sourceProfileKey,sourceRecordId:source.sourceRecordId,
    sourcePayloadSha256:source.sourcePayloadSha256,
    energyMethod:source.energyMethod,sourceFacts:source.sourceFacts,
    formScopeId:source.formScopeId||null,
    sourceArchiveSha256:source.sourceArchiveSha256||null
  });
  const evidenceSha256=createHash('sha256').update(evidence).digest('hex');
  return {status:'prepared_review_command_only',
    writerCommand:{
      p_actor_id:user.id,p_action_id:request.actionId,
      p_profile_id:request.profileId,p_expected_revision:request.expectedRevision,
      p_source_record_id:request.sourceRecordId,
      p_source_payload_sha256:source.sourcePayloadSha256,
      p_evidence_sha256:evidenceSha256,
      p_energy_policy_version:ENERGY,p_nutrient_set_version:NUTRIENTS,
      p_action:'review'
    },
    trustedServerTransactionRequired:true,releaseAuthorized:false,
    publicationAuthorized:false,calculationReady:false};
}
module.exports={buildReviewCommand,stableCanonical};
