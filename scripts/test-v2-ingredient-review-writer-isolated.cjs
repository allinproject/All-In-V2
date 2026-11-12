'use strict';
// ALL-222: isolated PGlite PostgreSQL test, never a live Supabase connection.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.cjs node --test this-file
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const candidate=fs.readFileSync(path.join(__dirname,'../docs/architecture/sql/V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql'),'utf8');
const canonicalSchema=fs.readFileSync(path.join(__dirname,'../docs/architecture/sql/V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql'),'utf8');
const setup=['CREATE ROLE anon NOLOGIN','CREATE ROLE authenticated NOLOGIN','CREATE ROLE service_role NOLOGIN'].join(';')+';';
const actorProfile='22222222-2222-4222-8222-222222222222',sourceHash='a'.repeat(64);
const fixture=[
  'CREATE ROLE ingredient_reviewer_a LOGIN',
  'CREATE ROLE ingredient_reviewer_b LOGIN',
  'CREATE ROLE ingredient_attacker LOGIN',
  'GRANT allin_v2_ingredient_reviewer TO ingredient_reviewer_a,ingredient_reviewer_b',
  "INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference) VALUES('ingredient_reviewer_a',true,'ISOLATED-TEST-ACTOR-A'),('ingredient_reviewer_b',false,'ISOLATED-TEST-ACTOR-B')",
  "INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,normalized_name,identity_kind,status) VALUES('11111111-1111-4111-8111-111111111111','black_beans_canned_drained','Black Beans - Canned Drained and Rinsed','black beans canned drained rinsed','generic_food','active')",
  "INSERT INTO public.v2_ingredient_nutrition_profiles(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,review_status,profile_revision,coverage_status,source_quality,required_nutrient_set_version,is_default) VALUES('"+actorProfile+"','11111111-1111-4111-8111-111111111111','cooked_drained','g',100,'100 g','candidate',1,'launch_core_complete','foundation_review','cookbook-launch-macros-v1',false)",
  "INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,source_description,source_quality,source_license,mapping_status,payload_sha256) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','usda_fdc','Foundation','2644285','Beans, black, canned, sodium added, drained and rinsed','reviewed_foundation_source','CC0','mapped',repeat('a',64))",
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
  await db.waitReady;await db.exec(setup);await db.exec(canonicalSchema);await db.exec(candidate);await db.exec(fixture);
  const grants=(await db.query("SELECT has_function_privilege('anon','allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)','EXECUTE') AS anon,has_function_privilege('service_role','allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)','EXECUTE') AS service")).rows[0];
  assert.equal(grants.anon,false);assert.equal(grants.service,false);
  // The real proposed RLS policies expose neither source candidates nor
  // nutrient rows while the profile is not calculation_ready.
  await db.exec('SET SESSION AUTHORIZATION authenticated');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.v2_ingredients')).rows[0].count,1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.v2_ingredient_nutrition_profiles')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.v2_ingredient_source_records')).rows[0].count,0);
  await denied(db,"UPDATE public.v2_ingredients SET status='retired'",'42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('SET SESSION AUTHORIZATION anon');
  await denied(db,'SELECT * FROM public.v2_ingredients','42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
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
  // Simulate a source refresh between reviewer decisions. A stale source hash
  // must not permit approval even when the profile revision is still current.
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec("UPDATE public.v2_ingredient_source_records SET payload_sha256=repeat('b',64) WHERE external_record_id='2644285'");
  await db.exec('SET SESSION AUTHORIZATION ingredient_reviewer_a');
  await denied(db,call(2,'reviewed',k2),'40001');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec("UPDATE public.v2_ingredient_source_records SET payload_sha256=repeat('a',64) WHERE external_record_id='2644285'");
  await db.exec('SET SESSION AUTHORIZATION ingredient_reviewer_a');
  await denied(db,call(2,'calculation_ready',k2),'23514');
  const second=(await db.query(call(2,'reviewed',k2))).rows[0].outcome;
  assert.equal(second.profile_revision,3);assert.equal(second.review_status,'reviewed');
  await denied(db,call(3,'calculation_ready',k3),'23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  // Complete, source-matched numeric data still cannot override the separate
  // ALL-225 method attestation / ALL-251 operator publication gate.
  await db.exec([
   "INSERT INTO public.v2_ingredient_aliases(id,ingredient_id,normalized_alias,locale,preparation_state,alias_kind,resolution_scope,status) VALUES('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','black beans canned sodium added drained and rinsed','en','cooked_drained','source_description','exact','active')",
   "INSERT INTO public.v2_nutrient_definitions(code,display_name,canonical_unit,launch_core,is_published) VALUES('energy_kcal','Calories','kcal',true,true),('protein_g','Protein','g',true,true),('carbohydrate_g','Carbohydrate','g',true,true),('total_fat_g','Total fat','g',true,true),('sodium_mg','Sodium','mg',false,true)",
   "INSERT INTO public.v2_ingredient_profile_nutrients(profile_id,nutrient_code,amount) VALUES('"+actorProfile+"','energy_kcal',115),('"+actorProfile+"','protein_g',6.91),('"+actorProfile+"','carbohydrate_g',19.8),('"+actorProfile+"','total_fat_g',1.27),('"+actorProfile+"','sodium_mg',218)"
  ].join(';')+';');
  await db.exec('SET SESSION AUTHORIZATION ingredient_reviewer_a');
  await denied(db,call(3,'calculation_ready',k3),'0A000');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const row=(await db.query("SELECT review_status,profile_revision FROM public.v2_ingredient_nutrition_profiles WHERE id='"+actorProfile+"'")).rows[0];
  assert.equal(row.review_status,'reviewed');assert.equal(row.profile_revision,3);
  const events=(await db.query('SELECT actor_db_login,previous_status,next_status,source_payload_sha256,required_nutrient_set_version FROM allin_private.v2_ingredient_review_events ORDER BY event_id')).rows;
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>e.previous_status+'>'+e.next_status),['candidate>needs_review','needs_review>reviewed']);
  assert(events.every(e=>e.actor_db_login==='ingredient_reviewer_a'&&e.source_payload_sha256===sourceHash&&e.required_nutrient_set_version==='cookbook-launch-macros-v1'));
  await denied(db,'DELETE FROM allin_private.v2_ingredient_review_events','42501');
  await denied(db,"UPDATE allin_private.v2_ingredient_review_events SET decision_reason='tampered'",'42501');
  // Search-only synonyms are not exact resolver aliases, even for a published
  // test-only fixture. This is NOT an approved source publication.
  await db.exec("INSERT INTO public.v2_ingredient_aliases(id,ingredient_id,normalized_alias,locale,preparation_state,alias_kind,resolution_scope,status) VALUES('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','black beans','en','cooked_drained','common_name','search_only','active')");
  await db.exec('SET SESSION AUTHORIZATION authenticated');
  const beforeReady=(await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles')).rows[0];
  assert.equal(beforeReady.n,0);
  const exactAliases=(await db.query('SELECT normalized_alias FROM public.v2_ingredient_aliases ORDER BY normalized_alias')).rows;
  assert.equal(exactAliases.length,1);
  assert.equal(exactAliases[0].normalized_alias,'black beans canned sodium added drained and rinsed');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  // Simulate a separately approved future release only for RLS select testing.
  // The actual controlled SQL writer has already rejected this transition.
  await db.exec("UPDATE public.v2_ingredient_nutrition_profiles SET review_status='calculation_ready' WHERE id='"+actorProfile+"'");
  // Additional isolated rows deliberately attempt to cross the publication
  // scope. Superseded source links, wildcard aliases and mismatched conversion
  // states must remain hidden even when the profile itself becomes visible.
  await db.exec("INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,source_description,source_quality,source_license,mapping_status,payload_sha256) VALUES('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','usda_fdc','Foundation','999000','superseded test source','reviewed_foundation_source','CC0','mapped',repeat('c',64))");
  await db.exec("INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role) VALUES('"+actorProfile+"','99999999-9999-4999-8999-999999999999','superseded')");
  await db.exec("INSERT INTO public.v2_ingredient_aliases(id,ingredient_id,normalized_alias,locale,preparation_state,alias_kind,resolution_scope,status) VALUES('99999999-9999-4999-8999-999999999998','11111111-1111-4111-8111-111111111111','beans','en',null,'common_name','exact','active')");
  await db.exec("INSERT INTO public.v2_ingredient_measure_conversions(id,ingredient_id,profile_id,preparation_state,from_quantity,from_unit,result_grams,conversion_kind,review_status) VALUES('99999999-9999-4999-8999-999999999997','11111111-1111-4111-8111-111111111111','"+actorProfile+"','raw',1,'cup',130,'household_density','reviewed'),('99999999-9999-4999-8999-999999999996','11111111-1111-4111-8111-111111111111','"+actorProfile+"','cooked_drained',1,'cup',130,'household_density','reviewed')");
  await db.exec("UPDATE public.v2_nutrient_definitions SET is_published=false WHERE code='sodium_mg'");
  await db.exec('SET SESSION AUTHORIZATION authenticated');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_profile_nutrients')).rows[0].n,4);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_source_records')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_profile_sources')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_aliases')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_measure_conversions')).rows[0].n,1);
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec("UPDATE public.v2_nutrient_definitions SET is_published=true WHERE code='sodium_mg'");
  await db.exec('SET SESSION AUTHORIZATION authenticated');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredient_profile_nutrients')).rows[0].n,5);
  await db.exec('SET SESSION AUTHORIZATION postgres');
 }finally{await db.close()}
});
