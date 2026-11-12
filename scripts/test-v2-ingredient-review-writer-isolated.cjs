'use strict';
// ALL-222: isolated PGlite PostgreSQL test, never a live Supabase connection.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.cjs node --test this-file
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const candidate=fs.readFileSync(path.join(__dirname,'../docs/architecture/sql/V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql'),'utf8');
const setup=[
  'CREATE SCHEMA allin_private',
  'CREATE ROLE anon NOLOGIN','CREATE ROLE authenticated NOLOGIN','CREATE ROLE service_role NOLOGIN',
  'CREATE TABLE public.v2_ingredients(id uuid PRIMARY KEY,identity_kind text NOT NULL,status text NOT NULL)',
  'CREATE TABLE public.v2_ingredient_aliases(id uuid PRIMARY KEY,ingredient_id uuid NOT NULL,preparation_state text,status text NOT NULL)',
  'CREATE TABLE public.v2_ingredient_nutrition_profiles(id uuid PRIMARY KEY,ingredient_id uuid NOT NULL,preparation_state text NOT NULL,basis_unit text NOT NULL,basis_quantity numeric NOT NULL,review_status text NOT NULL,profile_revision integer NOT NULL,coverage_status text NOT NULL,required_nutrient_set_version text NOT NULL,is_default boolean NOT NULL,reviewed_at timestamptz,updated_at timestamptz)',
  'CREATE TABLE public.v2_nutrient_definitions(code text PRIMARY KEY,canonical_unit text NOT NULL)',
  'CREATE TABLE public.v2_ingredient_profile_nutrients(profile_id uuid NOT NULL,nutrient_code text NOT NULL,amount numeric NOT NULL)',
  'CREATE TABLE public.v2_ingredient_source_records(id uuid PRIMARY KEY,ingredient_id uuid NOT NULL,provider text NOT NULL,source_data_type text NOT NULL,external_record_id text NOT NULL,mapping_status text NOT NULL,payload_sha256 text NOT NULL)',
  'CREATE TABLE public.v2_ingredient_profile_sources(profile_id uuid NOT NULL,source_record_id uuid NOT NULL,evidence_role text NOT NULL)',
  'CREATE TABLE public.v2_ingredient_measure_conversions(id uuid PRIMARY KEY)',
  'ALTER TABLE public.v2_ingredient_nutrition_profiles ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.v2_ingredient_profile_nutrients ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.v2_ingredient_source_records ENABLE ROW LEVEL SECURITY'
].join(';\n')+';';
const actorProfile='22222222-2222-4222-8222-222222222222',sourceHash='a'.repeat(64);
const fixture=[
  'CREATE ROLE ingredient_reviewer_a LOGIN',
  'CREATE ROLE ingredient_reviewer_b LOGIN',
  'CREATE ROLE ingredient_attacker LOGIN',
  'GRANT allin_v2_ingredient_reviewer TO ingredient_reviewer_a,ingredient_reviewer_b',
  "INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference) VALUES('ingredient_reviewer_a',true,'ISOLATED-TEST-ACTOR-A'),('ingredient_reviewer_b',false,'ISOLATED-TEST-ACTOR-B')",
  "INSERT INTO public.v2_ingredients(id,identity_kind,status) VALUES('11111111-1111-4111-8111-111111111111','generic_food','active')",
  "INSERT INTO public.v2_ingredient_nutrition_profiles(id,ingredient_id,preparation_state,basis_unit,basis_quantity,review_status,profile_revision,coverage_status,required_nutrient_set_version,is_default) VALUES('"+actorProfile+"','11111111-1111-4111-8111-111111111111','cooked_drained','g',100,'candidate',1,'launch_core_complete','cookbook-launch-macros-v1',false)",
  "INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,mapping_status,payload_sha256) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','usda_fdc','Foundation','2644285','mapped',repeat('a',64))",
  "INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role) VALUES('"+actorProfile+"','33333333-3333-4333-8333-333333333333','primary')"
].join(';\n')+';';
const k1='44444444-4444-4444-8444-444444444444';
const k2='55555555-5555-4555-8555-555555555555';
const k3='66666666-6666-4666-8666-666666666666';
const call=(revision,next,key,sha=sourceHash)=>
 "SELECT allin_private.v2_review_ingredient_profile_status('"+actorProfile+"',"+revision+",'"+sha+"','"+next+"','Reviewed USDA identity and preparation evidence','"+key+"') AS outcome";
const denied=async(db,sql,expectedCode)=>{
  await assert.rejects(()=>db.query(sql),e=>e&&e.code===expectedCode);
};
test('reviewer role, enrollment, idempotency, source digest, status guards and audit all fail closed',async()=>{
 const db=new PGlite();
 try{
  await db.waitReady;await db.exec(setup);await db.exec(candidate);await db.exec(fixture);
  const grants=(await db.query("SELECT has_function_privilege('anon','allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)','EXECUTE') AS anon,has_function_privilege('service_role','allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)','EXECUTE') AS service")).rows[0];
  assert.equal(grants.anon,false);assert.equal(grants.service,false);
  await db.exec('SET SESSION AUTHORIZATION ingredient_attacker');
  await denied(db,call(1,'needs_review',k1),'42501');
  await denied(db,"UPDATE public.v2_ingredient_nutrition_profiles SET review_status='calculation_ready'",'42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('SET SESSION AUTHORIZATION ingredient_reviewer_b');
  await denied(db,call(1,'needs_review',k1),'42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('SET SESSION AUTHORIZATION ingredient_attacker');
  await db.exec("SELECT set_config('allin_v2.ingredient_reviewer','ingredient_reviewer_a',false)");
  await denied(db,call(1,'needs_review',k1),'42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('SET SESSION AUTHORIZATION ingredient_reviewer_a');
  const first=(await db.query(call(1,'needs_review',k1))).rows[0].outcome;
  assert.equal(first.status,'reviewed');assert.equal(first.profile_revision,2);
  const replay=(await db.query(call(1,'needs_review',k1))).rows[0].outcome;
  assert.equal(replay.status,'replayed');assert.equal(replay.event_id,first.event_id);
  await denied(db,call(1,'reviewed',k1),'23505');
  await denied(db,call(1,'reviewed',k2),'40001');
  await denied(db,call(2,'reviewed',k2,'f'.repeat(64)),'40001');
  await denied(db,call(2,'calculation_ready',k2),'23514');
  const second=(await db.query(call(2,'reviewed',k2))).rows[0].outcome;
  assert.equal(second.profile_revision,3);assert.equal(second.review_status,'reviewed');
  await denied(db,call(3,'calculation_ready',k3),'23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const row=(await db.query("SELECT review_status,profile_revision FROM public.v2_ingredient_nutrition_profiles WHERE id='"+actorProfile+"'")).rows[0];
  assert.equal(row.review_status,'reviewed');assert.equal(row.profile_revision,3);
  const events=(await db.query('SELECT actor_db_login,previous_status,next_status,source_payload_sha256,required_nutrient_set_version FROM allin_private.v2_ingredient_review_events ORDER BY event_id')).rows;
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>e.previous_status+'>'+e.next_status),['candidate>needs_review','needs_review>reviewed']);
  assert(events.every(e=>e.actor_db_login==='ingredient_reviewer_a'&&e.source_payload_sha256===sourceHash&&e.required_nutrient_set_version==='cookbook-launch-macros-v1'));
  await denied(db,'DELETE FROM allin_private.v2_ingredient_review_events','42501');
  await denied(db,"UPDATE allin_private.v2_ingredient_review_events SET decision_reason='tampered'",'42501');
 }finally{await db.close()}
});
