'use strict';
// ALL-228: trusted server-side transaction adapter for the EXISTING canonical
// ingredient review writer. No direct table writes, publication or credentials.
// A valid source/identity preflight is necessary but never sufficient for
// calculation_ready; the database writer rechecks revision, digest and actor.
const {createHash}=require('node:crypto');
const {assessAutomaticSourceEvidence}=require('./review-v2-ingredient-identities.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITER='SELECT allin_private.v2_review_ingredient_profile_status($1::uuid,$2::integer,$3::text,$4::text,$5::text,$6::uuid) AS result';
function requestKey(profileId,revision,sha,stage) {
  // Stable replay identifiers for each stage. Version/variant comply with UUID.
  const bytes=createHash('sha256').update(JSON.stringify([
    'ALL-228-auto-canonical-review-v1',profileId,revision,sha,stage
  ])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;
  const h=bytes.toString('hex');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
function planAutomaticQualification({candidates,documents,sourceProfileKey,profileId,expectedRevision}) {
  if(!UUID.test(profileId||'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<1||
     typeof sourceProfileKey!=='string'||!sourceProfileKey.trim())
    throw Error('Trusted canonical profile ID, source key and positive revision required');
  const assessment=assessAutomaticSourceEvidence(candidates,documents);
  if(!assessment.automaticPreflightPassed ||
     assessment.results.length!==1 ||
     assessment.results[0].source_profile_key!==sourceProfileKey)
    throw Error('Automatic preflight blocked: source or identity requires exception handling');
  const source=documents.find(d=>d.source_profile_key===sourceProfileKey);
  if(!source||!/^[a-f0-9]{64}$/i.test(source.payload_sha256))
    throw Error('Trusted source digest required');
  const digest=source.payload_sha256.toLowerCase();
  const phases=[
    {revision:expectedRevision,status:'needs_review',reason:'Automated source and identity validation qualified candidate'},
    {revision:expectedRevision+1,status:'reviewed',reason:'Automated verified-source preflight completed atomically'}
  ];
  return Object.freeze({profileId,sourceProfileKey,sourceDigest:digest,
    phases:phases.map(p=>Object.freeze({...p,
      idempotencyKey:requestKey(profileId,p.revision,digest,p.status)})),
    calculationReady:false,publicationApproved:false});
}
async function runAutomaticQualification({client,...inputs}) {
  // The injected client MUST already be a trusted, server-only, independently
  // authenticated restricted DB session. No public RPC, service_role or anon.
  if(!client||typeof client.query!=='function')throw Error('Trusted database session required');
  const plan=planAutomaticQualification(inputs);
  let begun=false;
  try {
    await client.query('BEGIN');begun=true;
    // Existing canonical writer, including its actor authorization, source
    // row lock, CAS, immutable audit, idempotency and publication hard stop.
    // A reviewer-capability session is required; this code never elevates roles.
    const outputs=[];
    for(const p of plan.phases) {
      const q=await client.query(WRITER,[
        plan.profileId,p.revision,plan.sourceDigest,p.status,p.reason,p.idempotencyKey
      ]);
      const result=q?.rows?.[0]?.result;
      if(!result||!['reviewed','replayed'].includes(result.status)||
         result.profile_id!==plan.profileId||result.review_status!==p.status||
         result.profile_revision!==p.revision+1)
        throw Error('Canonical writer returned inconsistent status/revision receipt');
      outputs.push(result);
    }
    await client.query('COMMIT');begun=false;
    return {status:'source_qualified_not_published',profileId:plan.profileId,
      events:outputs,calculationReady:false,publicationApproved:false};
  } catch(error) {
    if(begun) {
      try {await client.query('ROLLBACK')} catch {
        throw Error('Canonical qualification failed; rollback outcome unknown: discard connection and verify database');
      }
    }
    throw error;
  }
}
module.exports={planAutomaticQualification,runAutomaticQualification,requestKey,WRITER};
