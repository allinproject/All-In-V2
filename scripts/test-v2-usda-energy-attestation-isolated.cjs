'use strict';
// ALL-225/222, isolated real PostgreSQL semantics; no live database access.
// PGLITE_MODULE=<verified offline PGlite path> node --test <this file>
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const sqlDir=path.join(__dirname,'../docs/architecture/sql');
const read=f=>fs.readFileSync(path.join(sqlDir,f),'utf8');
const statements=[
 'V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql',
 'V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql',
 'V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql',
 'V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql'
].map(read);
const profile='22222222-2222-4222-8222-222222222222';
const src='33333333-3333-4333-8333-333333333333';
const archive='dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579';
const sourceHash='a'.repeat(64);
const exe=(sqls)=>sqls.join(';\n')+';';
async function create(){
 const db=new PGlite();await db.waitReady;
 await db.exec(exe(['CREATE ROLE anon NOLOGIN','CREATE ROLE authenticated NOLOGIN','CREATE ROLE service_role NOLOGIN']));
 for(const sql of statements)await db.exec(sql);
 await db.exec(exe([
  'CREATE ROLE ingredient_test_operator LOGIN NOINHERIT',
  'CREATE ROLE ingredient_test_unauthorized LOGIN',
  'GRANT allin_v2_ingredient_reviewer TO ingredient_test_operator WITH INHERIT FALSE, SET TRUE',
  "INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES('ingredient_test_operator',true,'ISOLATED-REVIEW-TEST','https://test-idp.example','test-human-subject','vault://staging/test-operator-ref',now()-interval '1 hour',now()+interval '1 day')",
  "INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,normalized_name,identity_kind,status) VALUES('11111111-1111-4111-8111-111111111111','black_beans_canned_drained','Black beans drained rinsed','black beans drained rinsed','generic_food','active')",
  "INSERT INTO public.v2_ingredient_nutrition_profiles(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,review_status,profile_revision,coverage_status,source_quality,required_nutrient_set_version,is_default) VALUES('"+profile+"','11111111-1111-4111-8111-111111111111','cooked_drained','g',100,'100 g','reviewed',3,'launch_core_complete','foundation_review','cookbook-launch-macros-v1',false)",
  "INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,source_description,source_quality,source_license,mapping_status,payload_sha256) VALUES('"+src+"','11111111-1111-4111-8111-111111111111','usda_fdc','Foundation','2644285','Beans, black, canned, sodium added, drained and rinsed','foundation_review','CC0','mapped','"+sourceHash+"')",
  "INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role) VALUES('"+profile+"','"+src+"','primary')",
  "INSERT INTO public.v2_nutrient_definitions(code,display_name,canonical_unit,launch_core,is_published) VALUES('energy_kcal','Calories','kcal',true,true),('protein_g','Protein','g',true,true),('carbohydrate_g','Carbohydrate','g',true,true),('total_fat_g','Total fat','g',true,true),('sodium_mg','Sodium','mg',false,true)",
  "INSERT INTO public.v2_ingredient_profile_nutrients(profile_id,nutrient_code,amount) VALUES('"+profile+"','energy_kcal',115),('"+profile+"','protein_g',6.91),('"+profile+"','carbohydrate_g',19.8),('"+profile+"','total_fat_g',1.27),('"+profile+"','sodium_mg',218)"
 ]));
 return db;
}
const energyInsert=(method,value,fdc=src,hash=sourceHash,arch=archive)=>
 "INSERT INTO allin_private.v2_ingredient_source_energy_evidence(source_record_id,source_payload_sha256,archive_sha256,fdc_nutrient_id,energy_kcal,source_review_reference) VALUES('"+fdc+"','"+hash+"','"+arch+"',"+method+","+value+",'USDA Foundation 2026-10-29 verified')";
const attest=(revision=3,digest=sourceHash)=>
 "SELECT allin_private.v2_attest_ingredient_energy('"+profile+"',"+revision+",'"+digest+"','Reviewer confirmed source method and basis') AS decision";
const denied=async(db,query,code)=>assert.rejects(()=>db.query(query),e=>e?.code===code);
test('USDA 2048 specific takes precedence over 2047 general; attestation is immutable and not publication',async()=>{
 const db=await create();
 try{
  await db.exec(exe([energyInsert(2048,115),energyInsert(2047,118)]));
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_unauthorized');
  await denied(db,attest(),'42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  const decision=(await db.query(attest())).rows[0].decision;
  assert.equal(decision.status,'attested');
  assert.equal(decision.energy_fdc_nutrient_id,2048);
  assert.equal(decision.energy_kcal,115);
  assert.equal(decision.calculation_ready,false);
  const replay=(await db.query(attest())).rows[0].decision;
  assert.equal(replay.status,'already_attested');
  assert.equal(replay.attestation_id,decision.attestation_id);
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const row=(await db.query("SELECT review_status FROM public.v2_ingredient_nutrition_profiles WHERE id='"+profile+"'")).rows[0];
  assert.equal(row.review_status,'reviewed');
  const audit=(await db.query("SELECT selected_fdc_nutrient_id,archive_sha256,energy_policy_version FROM allin_private.v2_ingredient_energy_attestations")).rows[0];
  assert.equal(audit.selected_fdc_nutrient_id,2048);
  assert.equal(audit.archive_sha256,archive);
  assert.equal(audit.energy_policy_version,'usda-fdc-energy-specific-legacy-v1');
  await denied(db,'DELETE FROM allin_private.v2_ingredient_energy_attestations','42501');
  await denied(db,"UPDATE allin_private.v2_ingredient_source_energy_evidence SET energy_kcal=99",'42501');
 }finally{await db.close()}
});
test('general-only energy is never accepted; source digest and normalized kcal mismatch block',async()=>{
 const db=await create();
 try{
  await db.exec(energyInsert(2047,118));
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await denied(db,attest(),'23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec(energyInsert(2048,116));
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await denied(db,attest(),'23514');
  await denied(db,attest(3,'f'.repeat(64)),'40001');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_energy_attestations')).rows[0].n,0);
 }finally{await db.close()}
});
test('legacy 1008 is permitted only without 2048, with complete source identity and reviewed profile',async()=>{
 const db=await create();
 try{
  await db.exec("UPDATE public.v2_ingredient_profile_nutrients SET amount=84 WHERE profile_id='"+profile+"' AND nutrient_code='energy_kcal'");
  await db.exec(energyInsert(1008,84));
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  const result=(await db.query(attest())).rows[0].decision;
  assert.equal(result.status,'attested');
  assert.equal(result.energy_fdc_nutrient_id,1008);
  await denied(db,attest(2),'40001');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query("SELECT review_status FROM public.v2_ingredient_nutrition_profiles WHERE id='"+profile+"'")).rows[0].review_status,'reviewed');
 }finally{await db.close()}
});
test('revoked, expired or merely role-member operator cannot attest',async()=>{
 const db=await create();
 try{
  await db.exec(energyInsert(2048,115));
  await db.exec("UPDATE allin_private.v2_ingredient_review_operators SET credential_expires_at=clock_timestamp()-interval '1 second' WHERE login_role='ingredient_test_operator'");
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await denied(db,attest(),'42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec("UPDATE allin_private.v2_ingredient_review_operators SET credential_expires_at=clock_timestamp()+interval '1 day' WHERE login_role='ingredient_test_operator'");
  await db.exec("UPDATE allin_private.v2_ingredient_review_operators SET enabled=false,revoked_at=clock_timestamp() WHERE login_role='ingredient_test_operator'");
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await denied(db,attest(),'42501');
 }finally{await db.close()}
});

test('a source digest with an unapproved USDA archive hash cannot be attested',async()=>{
 const db=await create();
 try{
  await db.exec(energyInsert(2048,115,src,sourceHash,'f'.repeat(64)));
  await db.exec('SET SESSION AUTHORIZATION ingredient_test_operator');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await denied(db,attest(),'23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_energy_attestations')).rows[0].n,0);
 }finally{await db.close()}
});
