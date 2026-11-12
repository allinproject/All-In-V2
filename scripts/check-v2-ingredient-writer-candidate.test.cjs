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
