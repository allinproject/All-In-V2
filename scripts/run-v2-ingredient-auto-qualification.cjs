'use strict';
// ALL-228: trusted server-side transaction adapter for the EXISTING canonical
// ingredient review writer. No direct table writes, publication or credentials.
// A valid source/identity preflight is necessary but never sufficient for
// calculation_ready; the database writer rechecks revision, digest and actor.
const {createHash}=require('node:crypto');
const {assessAutomaticSourceEvidence}=require('./review-v2-ingredient-identities.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITER='SELECT allin_private.v2_review_ingredient_profile_status($1::uuid,$2::integer,$3::text,$4::text,$5::text,$6::uuid) AS result';
const ENERGY_WRITER='SELECT allin_private.v2_attest_ingredient_energy($1::uuid,$2::integer,$3::text,$4::text) AS result';
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
// Only the real restricted database session may report hosted readiness. This
// catalog query never creates permissions or data, and never substitutes for a
// real independent authentication or write/revocation acceptance test.
const HOSTED_READINESS_SQL=`
SELECT
  session_user::text AS login,
  current_user::text AS effective_role,
  to_regclass('public.v2_ingredients') IS NOT NULL AS ingredients,
  to_regclass('public.v2_ingredient_nutrition_profiles') IS NOT NULL AS profiles,
  to_regclass('public.v2_ingredient_source_records') IS NOT NULL AS sources,
  to_regclass('allin_private.v2_ingredient_review_events') IS NOT NULL AS review_events,
  to_regclass('allin_private.v2_ingredient_energy_attestations') IS NOT NULL AS energy_attestations,
  to_regprocedure('allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)') IS NOT NULL AS review_writer,
  to_regprocedure('allin_private.v2_attest_ingredient_energy(uuid,integer,text,text)') IS NOT NULL AS energy_writer,
  to_regrole('allin_v2_ingredient_reviewer') IS NOT NULL AS reviewer_role,
  to_regrole('allin_v2_ingredient_publisher') IS NOT NULL AS publisher_role,
  COALESCE((SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
    AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    FROM pg_catalog.pg_roles WHERE rolname=session_user),false) AS login_least_privileged,
  EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles role_granted ON role_granted.oid=m.roleid
    JOIN pg_catalog.pg_roles role_member ON role_member.oid=m.member
    WHERE role_granted.rolname='allin_v2_ingredient_reviewer'
      AND role_member.rolname=session_user) AS reviewer_member,
  EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles role_granted ON role_granted.oid=m.roleid
    JOIN pg_catalog.pg_roles role_member ON role_member.oid=m.member
    WHERE role_granted.rolname='allin_v2_ingredient_publisher'
      AND role_member.rolname=session_user) AS publisher_member,
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='v2_ingredient_nutrition_profiles'
      AND c.relrowsecurity) AS profiles_rls_enabled,
  has_schema_privilege(session_user,'public','CREATE') AS login_public_create,
  COALESCE(has_table_privilege(session_user,
    to_regclass('public.v2_ingredient_nutrition_profiles'),'UPDATE'),false) AS login_direct_profile_write,
  COALESCE(has_table_privilege(session_user,
    to_regclass('allin_private.v2_ingredient_review_events'),'SELECT'),false) AS login_private_audit_read,
  COALESCE(has_function_privilege(current_user,
    to_regprocedure('allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)'),
    'EXECUTE'),false) AS effective_review_execute,
  COALESCE(has_function_privilege(current_user,
    to_regprocedure('allin_private.v2_attest_ingredient_energy(uuid,integer,text,text)'),
    'EXECUTE'),false) AS effective_energy_execute,
  COALESCE(has_table_privilege(current_user,
    to_regclass('public.v2_ingredient_nutrition_profiles'),'UPDATE'),false) AS effective_direct_profile_write,
  COALESCE(has_table_privilege(current_user,
    to_regclass('allin_private.v2_ingredient_review_events'),'SELECT'),false) AS effective_private_audit_read;
`;
async function checkHostedIngestReadiness(client,{requirePublisher=false}={}) {
  if(!client||typeof client.query!=='function')throw Error('Trusted database session required');
  if(typeof requirePublisher!=='boolean')throw Error('Publisher gate must be an explicit boolean');
  const response=await client.query(HOSTED_READINESS_SQL);
  if(!response?.rows||response.rows.length!==1)throw Error('Hosted schema readiness unavailable');
  const proof=response.rows[0];
  const required=['ingredients','profiles','sources','review_events','energy_attestations',
    'review_writer','energy_writer','reviewer_role','publisher_role',
    'login_least_privileged','reviewer_member','profiles_rls_enabled',
    'effective_review_execute','effective_energy_execute'];
  const missing=required.filter(k=>proof[k]!==true);
  if(typeof proof.login!=='string'||
     !/^allin_ing_workload_[a-z0-9_]{6,35}$/.test(proof.login)||
     !['allin_v2_ingredient_reviewer',proof.login].includes(proof.effective_role)||
     proof.login_public_create!==false||
     proof.login_direct_profile_write!==false||
     proof.login_private_audit_read!==false||
     proof.effective_direct_profile_write!==false||
     proof.effective_private_audit_read!==false||
     proof.publisher_member!==requirePublisher||
     missing.length)
    throw Error('Hosted ingest readiness denied: '+(missing.join(',')||'identity, publish grant or schema creation'));
  // Not proof of a real service connection until executed on a genuine,
  // independently authenticated PostgreSQL session.
  return {ready:true,login:proof.login,publicationEnabled:requirePublisher};
}

async function runAutomaticQualification({client,attestEnergy=false,...inputs}) {
  // The injected client MUST already be a trusted, server-only, independently
  // authenticated restricted DB session. No public RPC, service_role or anon.
  if(!client||typeof client.query!=='function')throw Error('Trusted database session required');
  if(typeof attestEnergy!=='boolean')throw Error('Energy attestation mode must be explicit boolean');
  const plan=planAutomaticQualification(inputs);
  let begun=false,commitAttempted=false;
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
    let energyAttestation=null;
    if(attestEnergy) {
      // This is still NOT publication. The existing private SQL attestation
      // independently proves current revision, stored immutable archive digest,
      // permitted USDA energy method, and normalized per-100g core nutrients.
      // Failure rolls back the two status transitions and any partial evidence.
      const att=await client.query(ENERGY_WRITER,[
        plan.profileId,plan.phases[1].revision+1,plan.sourceDigest,
        'Automated immutable USDA source energy evidence verification'
      ]);
      const evidence=att?.rows?.[0]?.result;
      if(!evidence||!['attested','already_attested'].includes(evidence.status)||
         !(Number.isSafeInteger(Number(evidence.attestation_id))&&Number(evidence.attestation_id)>0)||
         evidence.calculation_ready===true)
        throw Error('Canonical energy attestation returned invalid receipt');
      energyAttestation=evidence;
    }
    commitAttempted=true;
    await client.query('COMMIT');begun=false;
    return {status:'source_qualified_not_published',profileId:plan.profileId,
      events:outputs,energyAttestation,calculationReady:false,publicationApproved:false};
  } catch(error) {
    // COMMIT can succeed even if its response is lost. Do NOT claim rollback
    // or send a compensating write after an ambiguous commit acknowledgement.
    if(commitAttempted)
      throw Error('Canonical qualification COMMIT outcome unknown: discard connection and inspect idempotent audit');
    if(begun) {
      try {await client.query('ROLLBACK')} catch {
        throw Error('Canonical qualification failed; rollback outcome unknown: discard connection and verify database');
      }
    }
    throw error;
  }
}
// The hosted entrypoint never executes the canonical transaction until a
// real restricted role has passed the read-only schema and permission gate.
// The low-level adapter remains available for isolated transactional tests.
async function runHostedAutomaticQualification({client,attestEnergy,...inputs}) {
  // Hosted callers must make the energy-evidence decision explicitly.
  // An omitted option must never silently downgrade an intended attestation
  // into a review-only operation or suggest publication eligibility.
  if(typeof attestEnergy!=='boolean')
    throw Error('Hosted energy attestation intent must be an explicit boolean');
  await checkHostedIngestReadiness(client,{requirePublisher:false});
  return runAutomaticQualification({client,attestEnergy,...inputs});
}
module.exports={planAutomaticQualification,runAutomaticQualification,
  runHostedAutomaticQualification,requestKey,WRITER,ENERGY_WRITER,
  HOSTED_READINESS_SQL,checkHostedIngestReadiness};
