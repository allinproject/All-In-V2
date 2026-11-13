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
  return executeCanonicalReviewPlan(client,plan,attestEnergy);
}
async function executeCanonicalReviewPlan(client,plan,attestEnergy) {
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

/**
 * Connect exception-only USDA source routing to the one canonical SQL review
 * writer. Only an already-mapped profile from trusted DB inventory is eligible.
 * This is not an ingredient creation writer, a public endpoint or publication.
 *
 * sourceFoods are the upstream official-archive-verified policy projections;
 * canonicalMappings are read-only authoritative DB identity/source revisions.
 * The document preflight independently validates normalized server-side facts,
 * while the writer uses the ORIGINAL pinned USDA payload digest stored in DB,
 * not a hash of the normalized document.
 */
async function runRoutedHostedAutomaticQualification({
  client,sourceFoods,sourceBindings,sourceEvidence,aliasPolicy,
  candidates,documents,canonicalMappings,attestEnergy
}) {
  if(typeof attestEnergy!=='boolean')
    throw Error('Hosted energy attestation intent must be an explicit boolean');
  if(!client||typeof client.query!=='function')
    throw Error('Trusted restricted database connection required');
  if(!Array.isArray(candidates)||!Array.isArray(documents)||
     !Array.isArray(sourceFoods)||!Array.isArray(canonicalMappings))
    throw Error('Exact source, identity, document and canonical mapping inventories required');
  const {reviewUsdaAdmission}=require('./review-v2-usda-source-admission.cjs');
  const {validateFdcNutrients}=require('./check-v2-usda-nutrient-policy.cjs');
  const assessment=reviewUsdaAdmission({sourceFoods,sourceBindings,sourceEvidence,aliasPolicy});
  const sourceByKey=new Map(),candidateByKey=new Map(),documentByKey=new Map(),mappingByKey=new Map();
  function uniqueIndex(rows,map,label) {
    for(const row of rows) {
      const key=row?.source_profile_key;
      if(typeof key!=='string'||!key||map.has(key))
        throw Error('Duplicate or invalid '+label+' identity; no write permitted');
      map.set(key,row);
    }
  }
  uniqueIndex(sourceFoods,sourceByKey,'source');
  uniqueIndex(candidates,candidateByKey,'candidate');
  uniqueIndex(documents,documentByKey,'normalized document');
  uniqueIndex(canonicalMappings,mappingByKey,'canonical mapping');
  // A canonical profile cannot be claimed by two distinct USDA source keys.
  // Reject the batch before BEGIN to avoid partial or cross-form promotion.
  const profileOwners=new Map();
  for(const mapping of canonicalMappings){
    if(!UUID.test(mapping?.profileId||''))continue;
    const profile=mapping.profileId.toLowerCase();
    if(profileOwners.has(profile)&&profileOwners.get(profile)!==mapping.source_profile_key)
      throw Error('Conflicting canonical profile mapping; batch blocked');
    profileOwners.set(profile,mapping.source_profile_key);
  }
  const exceptions=[],eligible=[];
  for(const route of assessment.qualificationQueue||[]) {
    const key=route.source_profile_key;
    if(route.route!=='automatic_qualification') {
      exceptions.push({source_profile_key:key,reasons:route.reasons,route:'exception_review'});
      continue;
    }
    const source=sourceByKey.get(key),candidate=candidateByKey.get(key),
      document=documentByKey.get(key),mapping=mappingByKey.get(key);
    const reasons=[];
    if(!source||!candidate||!document||!mapping)
      reasons.push('missing_trusted_canonical_mapping_or_source_document');
    else if(!UUID.test(mapping.profileId||'')||
            !Number.isSafeInteger(mapping.expectedRevision)||mapping.expectedRevision<1||
            mapping.sourceFdcId!==String(source.fdcId)||
            mapping.sourcePayloadSha256!==source.payload_sha256||
            !/^[a-f0-9]{64}$/.test(source.payload_sha256))
      reasons.push('canonical_mapping_source_revision_mismatch');
    else {
      try {
        const normalizedPlan=planAutomaticQualification({
          candidates:[candidate],documents:[document],sourceProfileKey:key,
          profileId:mapping.profileId,expectedRevision:mapping.expectedRevision
        });
        // The normalized document must represent the same nutrient facts as
        // the admitted USDA food, even though their SHA encodings differ.
        const originalNutrients=validateFdcNutrients({
          ...source,require_sodium:true
        });
        const parsed=JSON.parse(document.payload_utf8);
        const normalizedNutrients=validateFdcNutrients({
          ...parsed,require_sodium:true
        });
        if(originalNutrients.issues.length||normalizedNutrients.issues.length||
           originalNutrients.chosenEnergyNutrientId!==normalizedNutrients.chosenEnergyNutrientId||
           JSON.stringify(originalNutrients.facts)!==JSON.stringify(normalizedNutrients.facts)||
           parsed.source_description!==undefined&&parsed.source_description!==source.source_description)
          throw Error('normalized_and_official_source_nutrients_disagree');
        const canonicalDigest=source.payload_sha256;
        const plan={...normalizedPlan,sourceDigest:canonicalDigest,
          phases:normalizedPlan.phases.map(p=>({...p,
            idempotencyKey:requestKey(mapping.profileId,p.revision,canonicalDigest,p.status)}))};
        eligible.push({source_profile_key:key,plan});
      }catch {
        reasons.push('canonical_preflight_or_nutrient_binding_failed');
      }
    }
    if(reasons.length)
      exceptions.push({source_profile_key:key,reasons,route:'exception_review'});
  }
  // Unlisted or extra identity/mapping documents do not silently gain access.
  const known=new Set((assessment.qualificationQueue||[]).map(r=>r.source_profile_key));
  if([...candidateByKey.keys(),...documentByKey.keys(),...mappingByKey.keys()]
    .some(key=>!known.has(key)))
    throw Error('Orphan identity, document or mapping; batch blocked');
  if(!assessment.sourceContractValidated||!assessment.aliasContractValidated)
    return {status:'review_required',qualified:[],exceptions:
      [...(assessment.qualificationQueue||[]).map(r=>({
        source_profile_key:r.source_profile_key,route:'exception_review',
        reasons:['global_source_or_alias_contract_failed']}))],
      calculationReady:false,publicationApproved:false};
  // No hosted query or BEGIN until source routing and exact mapping checks
  // are complete. If all are exceptions, report them without DB access.
  if(!eligible.length)
    return {status:'exception_review_only',qualified:[],exceptions,
      calculationReady:false,publicationApproved:false};
  await checkHostedIngestReadiness(client,{requirePublisher:false});
  const qualified=[];
  for(const item of eligible) {
    // Existing canonical SQL writer, CAS, audit and attestation transaction.
    // Failures cannot be downgraded to successful qualification, and ambiguous
    // COMMIT outcomes require human operational reconciliation, not retries.
    const result=await executeCanonicalReviewPlan(client,item.plan,attestEnergy);
    qualified.push({source_profile_key:item.source_profile_key,profileId:result.profileId,
      status:result.status,energyAttestation:result.energyAttestation});
  }
  return {status:exceptions.length?'partially_qualified':'source_qualified_not_published',
    qualified,exceptions,calculationReady:false,publicationApproved:false};
}

/**
 * Authoritative mapping reader: the existing catalog is the sole source of
 * identity/revision truth. This reader must be a separate TRUSTED server-side
 * database connection configured to read private candidate catalog rows.
 * The mobile/athlete RLS reader cannot read unqualified candidate rows, and
 * callers must never supply profile IDs or a replacement mapping inventory.
 * Read-only here; no SECURITY DEFINER bypass or new catalog schema.
 */
const CANONICAL_MAPPING_READER_SQL=`
SELECT
 s.provider, s.source_data_type, s.external_record_id,
 s.source_description, s.payload_sha256, s.mapping_status,
 s.ingredient_id AS source_ingredient_id, s.id AS source_record_id,
 ps.evidence_role, p.id AS profile_id, p.ingredient_id AS profile_ingredient_id,
 p.preparation_state, p.basis_unit, p.basis_quantity,
 p.review_status, p.profile_revision,
 i.id AS canonical_ingredient_id, i.status AS ingredient_status
FROM public.v2_ingredient_source_records s
LEFT JOIN public.v2_ingredient_profile_sources ps
 ON ps.source_record_id=s.id AND ps.evidence_role='primary'
LEFT JOIN public.v2_ingredient_nutrition_profiles p ON p.id=ps.profile_id
LEFT JOIN public.v2_ingredients i ON i.id=s.ingredient_id
WHERE s.provider='usda_fdc' AND s.source_data_type='Foundation'
 AND s.external_record_id = ANY($1::text[])
ORDER BY s.external_record_id, p.id;
`;
// Explicitly fail if the reader is anonymous, a mobile role, or an unscoped
// superuser. Runtime deployment must provision its own restricted, vetted
// catalog reader privileges; this code never creates grants or credentials.
const CANONICAL_READER_IDENTITY_SQL=`
SELECT session_user::text AS login,
 current_user::text AS effective_role,
 COALESCE((SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
  AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
  FROM pg_catalog.pg_roles WHERE rolname=session_user),false)
  AS least_privileged,
 has_table_privilege(current_user,'public.v2_ingredient_source_records','SELECT') AS source_select,
 has_table_privilege(current_user,'public.v2_ingredient_profile_sources','SELECT') AS link_select,
 has_table_privilege(current_user,'public.v2_ingredient_nutrition_profiles','SELECT') AS profile_select,
 has_table_privilege(current_user,'public.v2_ingredients','SELECT') AS ingredient_select,
 has_table_privilege(current_user,'public.v2_ingredient_source_records','UPDATE') AS source_update,
 has_table_privilege(current_user,'public.v2_ingredient_nutrition_profiles','UPDATE') AS profile_update;
`;
const FDC_ID=/^[1-9][0-9]{0,11}$/;
async function readCanonicalMappingsFromDatabase({reader,sourceFoods}) {
 if(!reader||typeof reader.query!=='function'||!Array.isArray(sourceFoods)||
    sourceFoods.length<1||sourceFoods.length>1000)
   throw Error('Trusted catalog reader and bounded exact sources required');
 const ids=[],keys=new Set(),fdcs=new Set();
 for(const food of sourceFoods) {
   if(typeof food?.source_profile_key!=='string'||!food.source_profile_key||
      keys.has(food.source_profile_key)||!FDC_ID.test(String(food.fdcId))||
      fdcs.has(String(food.fdcId))||typeof food.payload_sha256!=='string'||
      !/^[a-f0-9]{64}$/.test(food.payload_sha256))
     throw Error('Invalid or repeated USDA source request; no mapping read');
   keys.add(food.source_profile_key);fdcs.add(String(food.fdcId));ids.push(String(food.fdcId));
 }
 const identity=await reader.query(CANONICAL_READER_IDENTITY_SQL);
 const auth=identity?.rows?.length===1?identity.rows[0]:null;
 if(!auth||typeof auth.login!=='string'||
    !/^allin_ing_catalog_reader_[a-z0-9_]{4,35}$/.test(auth.login)||
    ![auth.login,'allin_v2_ingredient_catalog_reader'].includes(auth.effective_role)||
    ['least_privileged','source_select','link_select','profile_select','ingredient_select']
      .some(k=>auth[k]!==true)||
    auth.source_update!==false||auth.profile_update!==false)
   throw Error('Canonical catalog reader identity/permission gate denied');
 const response=await reader.query(CANONICAL_MAPPING_READER_SQL,[ids]);
 if(!Array.isArray(response?.rows))
   throw Error('Canonical catalog reader result unavailable');
 const byFdc=new Map();
 for(const row of response.rows) {
   if(!fdcs.has(row.external_record_id))
     throw Error('Catalog reader returned an unrequested source');
   const list=byFdc.get(row.external_record_id)||[];
   list.push(row);byFdc.set(row.external_record_id,list);
 }
 const mappings=[],exceptions=[];
 for(const food of sourceFoods) {
   const found=byFdc.get(String(food.fdcId))||[];
   const reasons=[];
   if(found.length!==1)reasons.push('canonical_source_or_primary_mapping_missing_or_ambiguous');
   else {
     const row=found[0];
     if(row.provider!=='usda_fdc'||row.source_data_type!=='Foundation'||
        row.source_description!==food.source_description||
        row.payload_sha256!==food.payload_sha256||
        row.mapping_status!=='mapped'||
        row.ingredient_status!=='active'||
        row.evidence_role!=='primary'||
        row.source_ingredient_id!==row.profile_ingredient_id||
        row.source_ingredient_id!==row.canonical_ingredient_id||
        row.preparation_state!==food.proposed_preparation_state||
        row.basis_unit!=='g'||Number(row.basis_quantity)!==100||
        row.review_status!=='candidate'||
        !UUID.test(row.profile_id||'')||
        !UUID.test(row.canonical_ingredient_id||'')||
        !Number.isSafeInteger(Number(row.profile_revision))||
        Number(row.profile_revision)<1)
        reasons.push('canonical_identity_source_form_revision_or_digest_mismatch');
     else mappings.push({
       source_profile_key:food.source_profile_key,
       profileId:row.profile_id,
       expectedRevision:Number(row.profile_revision),
       sourceFdcId:String(food.fdcId),
       sourcePayloadSha256:food.payload_sha256
     });
   }
   if(reasons.length)exceptions.push({
     source_profile_key:food.source_profile_key,route:'exception_review',reasons
   });
 }
 return {canonicalMappings:mappings,exceptions};
}
/**
 * The only hosted routing entrypoint that resolves canonical mapping from DB.
 * The caller supplies verified official source projections, never UUID mappings.
 * Existing CAS/digest locks in the canonical writer recheck the selected source.
 */
async function runRoutedHostedAutomaticQualificationFromDatabase({
  reader,client,sourceFoods,sourceBindings,sourceEvidence,aliasPolicy,
  candidates,documents,attestEnergy
}) {
 if(typeof attestEnergy!=='boolean')
   throw Error('Hosted energy attestation intent must be an explicit boolean');
 const {reviewUsdaAdmission}=require('./review-v2-usda-source-admission.cjs');
 const routes=reviewUsdaAdmission({sourceFoods,sourceBindings,sourceEvidence,aliasPolicy});
 if(!routes.sourceContractValidated||!routes.aliasContractValidated||
    !Array.isArray(routes.qualificationQueue))
   return {status:'review_required',qualified:[],exceptions:
     (routes.qualificationQueue||[]).map(x=>({
       source_profile_key:x.source_profile_key,route:'exception_review',
       reasons:['global_source_or_alias_contract_failed']})),
     calculationReady:false,publicationApproved:false};
 const eligibleKeys=new Set(routes.qualificationQueue.filter(x=>
   x.route==='automatic_qualification').map(x=>x.source_profile_key));
 if(!eligibleKeys.size)
   return {status:'exception_review_only',qualified:[],exceptions:
     routes.qualificationQueue.map(x=>({
       source_profile_key:x.source_profile_key,route:'exception_review',reasons:x.reasons
     })),calculationReady:false,publicationApproved:false};
 // Only source-passing rows are read from the catalog. The authoritative
 // catalog row, not caller-provided IDs, chooses the profile to review.
 const scoped=sourceFoods.filter(f=>eligibleKeys.has(f.source_profile_key));
 const formByKey=new Map(routes.sourceRows.map(r=>[
   r.source_profile_key,r.proposed_preparation_state
 ]));
 const read=await readCanonicalMappingsFromDatabase({reader,
   sourceFoods:scoped.map(f=>({...f,
     proposed_preparation_state:formByKey.get(f.source_profile_key)}))
 });
 const result=await runRoutedHostedAutomaticQualification({
   client,sourceFoods,sourceBindings,sourceEvidence,aliasPolicy,candidates,documents,
   canonicalMappings:read.canonicalMappings,attestEnergy
 });
 return {...result,
   exceptions:[...result.exceptions.map(e=>{
     const precise=read.exceptions.find(x=>x.source_profile_key===e.source_profile_key);
     return precise||e;
   })],
   canonicalMappingsReadFromDatabase:true};
}
module.exports={planAutomaticQualification,runAutomaticQualification,
  runHostedAutomaticQualification,runRoutedHostedAutomaticQualification,
  readCanonicalMappingsFromDatabase,runRoutedHostedAutomaticQualificationFromDatabase,
  CANONICAL_MAPPING_READER_SQL,CANONICAL_READER_IDENTITY_SQL,
  requestKey,WRITER,ENERGY_WRITER,
  HOSTED_READINESS_SQL,checkHostedIngestReadiness};
