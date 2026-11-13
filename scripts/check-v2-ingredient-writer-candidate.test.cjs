'use strict';
// ALL-222 static contract guard. This is NOT a substitute for PostgreSQL tests.
// The exact isolated runtime suite is test-v2-ingredient-review-writer-isolated.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../docs/architecture/sql');
const catalog=fs.readFileSync(path.join(root,'V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql'),'utf8');
const writer=fs.readFileSync(path.join(root,'V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql'),'utf8');
const lifecycle=fs.readFileSync(path.join(root,'V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql'),'utf8');
const energy=fs.readFileSync(path.join(root,'V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql'),'utf8');
const assertHas=(s,fragment)=>assert(s.includes(fragment),'missing safety guard: '+fragment);
test('SQL remains in review-only candidate files, never production migration',()=>{
 for(const s of [catalog,writer]){
  assertHas(s,'NOT A');
  assertHas(s,'DO NOT');
 }
 assert(!catalog.includes('CREATE TABLE public.v2_recipe_nutrition_calculations'));
});
test('eight canonical shared tables use RLS and SELECT-only athlete grants',()=>{
 const tables=['v2_ingredients','v2_ingredient_aliases','v2_ingredient_nutrition_profiles',
 'v2_nutrient_definitions','v2_ingredient_profile_nutrients','v2_ingredient_source_records',
 'v2_ingredient_profile_sources','v2_ingredient_measure_conversions'];
 for(const table of tables){
  assertHas(catalog,'CREATE TABLE public.'+table);
  assertHas(catalog,'ALTER TABLE public.'+table+' ENABLE ROW LEVEL SECURITY');
  assertHas(catalog,'public.'+table);
 }
 assertHas(catalog,'GRANT SELECT ON TABLE');
 assertHas(catalog,'TO authenticated;');
 assertHas(catalog,'FROM PUBLIC,anon,authenticated,service_role;');
 assert(!/CREATE POLICY [^\n]+ FOR (?:INSERT|UPDATE|DELETE|ALL)/i.test(catalog));
});
test('source visibility is linked to its own ID and the published ingredient',()=>{
 assertHas(catalog,'ps.source_record_id=v2_ingredient_source_records.id');
 assertHas(catalog,'p.ingredient_id=v2_ingredient_source_records.ingredient_id');
 assertHas(catalog,"p.review_status='calculation_ready'");
 assertHas(catalog,"status='active' AND resolution_scope='exact'");
 assertHas(catalog,'v2_ingredient_ready_default_unique');
 assertHas(catalog,'UNIQUE(provider,source_data_type,external_record_id)');
});
test('writer accepts trusted DB actor only, not a service key or user claim',()=>{
 for(const x of ['session_user','pg_has_role','allin_v2_ingredient_review_operators',
 'allin_v2_ingredient_reviewer','NOLOGIN NOINHERIT NOBYPASSRLS',
 'REVOKE ALL ON FUNCTION','FROM PUBLIC, anon, authenticated, service_role']){
  // audit registration uses the exact allin_private table spelling.
  if(x==='allin_v2_ingredient_review_operators') continue;
  assertHas(writer,x);
 }
 assertHas(writer,'allin_private.v2_ingredient_review_operators');
 assert(!/GRANT\s+allin_v2_ingredient_reviewer\s+TO\s+/i.test(writer));
});
test('state transitions lock both profile and source with stale/replay guards',()=>{
 for(const x of ['pg_advisory_xact_lock','FOR UPDATE','FOR SHARE OF s',
  'p_expected_revision','p_expected_source_sha256','source_payload_sha256',
  'idempotency_key','request_payload','previous_revision','next_revision',
  'profile_revision=v_old.profile_revision+1','source record changed since reviewer']){
  assertHas(writer,x);
 }
 assertHas(writer,"ERRCODE='40001'");
 assertHas(writer,"ERRCODE='23505'");
 assertHas(writer,"ERRCODE='23514'");
});
test('audit records remain immutable and calculation_ready stays blocked',()=>{
 assertHas(writer,'v2_ingredient_review_events_immutable');
 assertHas(writer,'BEFORE UPDATE OR DELETE');
 assertHas(writer,"reviewed-source sodium evidence missing");
 assertHas(writer,"calculation_ready blocked pending method attestation");
 assertHas(writer,"ERRCODE='0A000'");
});

test('reviewer identity requires a verified issuer, subject, vault reference, expiry and revocation audit',()=>{
 for(const term of ['identity_issuer','identity_subject','credential_vault_reference',
  'identity_verified_at','credential_expires_at','revoked_at',
  'v2_ingredient_operator_identity_unique','v2_ingredient_operator_credential_events',
  'v2_ingredient_operator_no_delete','BEFORE DELETE','credential_events_immutable']){
  assertHas(lifecycle,term);
 }
 for(const term of ['o.credential_expires_at > clock_timestamp()','o.revoked_at IS NULL',
  'o.identity_subject IS NOT NULL','pg_has_role','FOR SHARE OF o']){
  assertHas(writer,term);
  assertHas(energy,term);
 }
 assert(!/CREATE ROLE\s+[^;]+LOGIN\s+PASSWORD/i.test(lifecycle));
});
test('energy attestation is immutable, source-bound and never grants publication',()=>{
 for(const term of ['v2_ingredient_source_energy_evidence','v2_ingredient_energy_attestations',
  'source_payload_sha256','archive_sha256','FOR UPDATE','FOR SHARE OF s',
  "'usda-fdc-energy-specific-legacy-v1'","fdc_nutrient_id=2048",
  "fdc_nutrient_id=1008","2047 alone is insufficient",
  'selected_energy_kcal','normalized energy differs','energy_attestation_immutable',
  "'calculation_ready',false"]){
   assertHas(energy,term);
 }
 assertHas(writer,'calculation_ready blocked pending method attestation');
 assertHas(energy,'NO client-supplied attestation');
 assert(!/GRANT\s+(?:INSERT|UPDATE|DELETE)\s+ON\s+allin_private\.v2_ingredient_energy_attestations/i.test(energy));
});

test('privileged canonical reviewer and energy functions retain a trusted search path',()=>{
 for(const source of [writer,energy]){
  assertHas(source,'SET search_path = pg_catalog, pg_temp');
  assert(!/SECURITY DEFINER\s+SET search_path\s*=\s*pg_catalog\s*,\s*public/i.test(source));
 }
});


const evidenceRoot=path.join(__dirname,'../docs/evidence');
const readEvidence=(filename)=>JSON.parse(fs.readFileSync(path.join(evidenceRoot,filename),'utf8'));
test('eight source-anchored food identities retain exact source and preparation evidence',()=>{
 const source=readEvidence('ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json');
 const bindings=readEvidence('ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json');
 const aliasPolicy=readEvidence('ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json');
 const digests=readEvidence('ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json');
 const hash='dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579';
 for(const record of [source,bindings,digests]){
  assert.equal(record.archiveSha256??record.sourceEvidenceArchiveSha256,hash);
 }
 assert.equal(source.records.length,8);
 assert.equal(bindings.bindings.length,8);
 assert.equal(aliasPolicy.records.length,8);
 assert.equal(digests.records.length,8);
 const uniqueIds=new Set(),uniqueKeys=new Set();
 for(const food of source.records){
  assert(!uniqueIds.has(food.fdcId),'duplicate FDC source ID');uniqueIds.add(food.fdcId);
  assert(!uniqueKeys.has(food.profile),'duplicate profile key');uniqueKeys.add(food.profile);
  const binding=bindings.bindings.find(x=>Number(x.reviewed_source_reference.external_record_id)===food.fdcId);
  const policy=aliasPolicy.records.find(x=>Number(x.source_fdc_id)===food.fdcId);
  const digest=digests.records.find(x=>x.fdcId===food.fdcId);
  assert(binding&&policy&&digest,'missing exact source evidence');
  assert.equal(binding.source_profile_key,food.profile);
  assert.equal(policy.source_profile_key,food.profile);
  assert.equal(binding.reviewed_source_reference.source_food_description,food.source);
  assert.equal(policy.source_description,food.source);
  assert.equal(policy.preparation_state,binding.proposed_preparation_state);
  assert.equal(binding.reviewed_source_reference.source_data_type,'Foundation');
  assert.equal(binding.nutrition_evidence.basis_quantity,100);
  assert.equal(binding.nutrition_evidence.basis_unit,'g');
  assert.equal(Number(food.energy.code),digest.selectedFdcNutrientId);
  assert.equal(food.energy.kcal,digest.selectedEnergyKcal);
  assert.match(digest.sourcePayloadSha256,/^[a-f0-9]{64}$/);
  assert([1008,2048].includes(digest.selectedFdcNutrientId));
  for(const key of ['protein','carbs','fat','sodiumMg']){
   assert(Number.isFinite(food[key])&&food[key]>=0,'missing or invalid reviewed-source nutrient '+key);
  }
  assert.equal(binding.canonical_v2_id,null);
  assert.equal(binding.identity_approval,'pending_reviewer');
  assert.equal(binding.profile_approval,'pending_reviewer');
  assert.equal(policy.canonical_identity_approved,false);
  assert.equal(policy.profile_calculation_ready,false);
  assert.equal(policy.approved_for_publication,false);
 }
 assert.equal(bindings.calculationReady,false);
 assert.equal(bindings.approvedForPublication,false);
 assert.equal(aliasPolicy.calculationReady,false);
 assert.equal(aliasPolicy.publicationApproved,false);
 assert.equal(digests.profilesApproved,false);
 assert.equal(digests.publicationApproved,false);
});
test('thirteen scoped exact aliases do not broaden source food forms',()=>{
 const policy=readEvidence('ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json');
 const exact=new Map();
 for(const record of policy.records){
  assert(record.exact_alias_candidates.length>0);
  const searchOnly=new Set(record.search_only_not_exact_aliases.map(a=>a.value.toLowerCase().trim().replace(/\s+/g,' ')));
  const excluded=new Set((record.excluded_incompatible_queries??[]).map(a=>a.value.toLowerCase().trim().replace(/\s+/g,' ')));
  for(const alias of record.exact_alias_candidates){
   const normalized=alias.value.toLowerCase().trim().replace(/\s+/g,' ');
   const key=[record.locale,record.preparation_state,normalized].join('|');
   assert(!exact.has(key),'ambiguous exact alias '+key);
   exact.set(key,record.source_fdc_id);
   assert.equal(alias.preparation_state,record.preparation_state);
   assert.equal(alias.kind,'source_scoped_exact');
   assert.equal(alias.selection_scope,'requires_explicit_source_form_confirmation');
   assert(!searchOnly.has(normalized),'broad search term promoted to exact alias');
   assert(!excluded.has(normalized),'incompatible food form promoted to exact alias');
  }
 }
 assert.equal(exact.size,13);
});


test('each USDA food retains its explicit form restrictions and distinct calorie method',()=>{
 const source=readEvidence('ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json');
 const policy=readEvidence('ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json');
 const expectations=[
  [328841,'milk_cottage_2pct','prepared',['2% milkfat'],['different_milkfat','specific_brand']],
  [790577,'red_onion_raw','raw',['red','raw'],['cooked','different_color']],
  [2346407,'cabbage_green_raw','raw',['green','raw'],['cooked','cup_to_grams_without_review']],
  [2644285,'black_beans_canned_drained','cooked_drained',['black','sodium added','drained and rinsed'],['unrinsed','without_added_salt','dry']],
  [2644288,'chickpeas_canned_drained_rinsed','cooked_drained',['chickpeas','sodium added','drained and rinsed'],['unrinsed','without_added_salt','dry']],
  [2644289,'beans_kidney_canned_drained','cooked_drained',['kidney','dark red','sodium added','sugar added','drained and rinsed'],['without_added_sugar','light_red','undrained']],
  [2685580,'tomato_paste_canned_unsalted','prepared',['paste','without salt added'],['with_added_salt','double_concentrated','sodium_free_assumption']],
  [2685581,'tomatoes_crushed_canned','prepared',['crushed','canned'],['with_specific_spices','low_sodium','undrained_to_drained']]
 ];
 const byId=new Map(source.records.map(r=>[r.fdcId,r]));
 const policyById=new Map(policy.records.map(r=>[Number(r.source_fdc_id),r]));
 for(const [id,key,state,descriptionTerms,excludedForms] of expectations){
  const food=byId.get(id),scope=policyById.get(id);
  assert(food&&scope,'missing pinned source '+id);
  assert.equal(food.profile,key);
  assert.equal(scope.preparation_state,state);
  const description=food.source.toLowerCase();
  for(const term of descriptionTerms)assert(description.includes(term),id+' source form lost: '+term);
  for(const form of excludedForms)assert(scope.incompatible_form_conditions.includes(form),id+' incompatible form not blocked: '+form);
  assert(food.caveats.length>0,id+' must retain manual review caveats');
  assert.equal(scope.identity_kind,'generic_food');
  assert.equal(scope.canonical_identity_approved,false);
  assert.equal(scope.profile_calculation_ready,false);
  const selected=Number(food.energy.code);
  assert.equal(selected,id===328841||id===790577?1008:2048,id+' energy method unexpectedly changed');
  if(selected===2048){
   assert.equal(Number(food.energy.alternative?.code),2047,id+' 2047 source alternative must remain separate');
   assert.notEqual(food.energy.kcal,food.energy.alternative.kcal,id+' selected energy must not silently use general factors');
  } else assert.equal(food.energy.alternative,undefined);
 }
 // Source-specific portion evidence is never permission to invent a generic
 // one-can, drained-yield, density, one-cup or cooked-weight conversion.
 const bindings=readEvidence('ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json');
 for(const binding of bindings.bindings){
  assert.equal(binding.conversion_review.household_and_purchase_yields_approved,false);
  assert.equal(binding.identity_approval,'pending_reviewer');
  assert.equal(binding.profile_approval,'pending_reviewer');
 }
});


test('verified USDA source evidence cannot be mistaken for canonical approval',()=>{
 const bindings=readEvidence('ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json');
 const digests=readEvidence('ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json');
 const attestation=bindings.source_attestation;
 assert.equal(attestation.status,'original_archive_raw_nutrient_verification_passed_not_identity_approval');
 assert.equal(attestation.verified_record_count,8);
 assert.equal(attestation.verified_nutrient_observations,40);
 assert.equal(attestation.archive_sha256,digests.archiveSha256);
 const sources=new Map(digests.records.map(record=>[String(record.fdcId),record]));
 assert.equal(sources.size,8);
 for(const binding of bindings.bindings){
  const source=sources.get(binding.reviewed_source_reference.external_record_id);
  assert(source,'verified source evidence has no pinned USDA digest');
  assert.equal(binding.nutrition_evidence.raw_archive_nutrient_observations_verified,true);
  assert.equal(binding.nutrition_evidence.source_payload_sha256_verified,source.sourcePayloadSha256);
  assert.deepEqual(binding.nutrition_evidence.raw_archive_verified_nutrient_ids,[1003,1004,1005,1093,source.selectedFdcNutrientId]);
  assert.equal(binding.canonical_v2_id,null);
  assert.equal(binding.identity_approval,'pending_reviewer');
  assert.equal(binding.profile_approval,'pending_reviewer');
  assert.equal(binding.conversion_review.household_and_purchase_yields_approved,false);
 }
 assert.equal(bindings.calculationReady,false);
 assert.equal(bindings.approvedForPublication,false);
 assert.equal(bindings.authorizedToWrite,false);
});
