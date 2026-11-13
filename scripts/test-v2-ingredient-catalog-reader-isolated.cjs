'use strict';
// Disposable SQL/RLS acceptance. Never connects to hosted Supabase.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {readCanonicalMappingsFromDatabase,CANONICAL_MAPPING_READER_SQL}=require('./run-v2-ingredient-auto-qualification.cjs');
const schema=n=>fs.readFileSync(path.join(__dirname,'../docs/architecture/sql',n),'utf8');
const ing='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222',src='33333333-3333-4333-8333-333333333333',sha='a'.repeat(64);
async function setup(){
 const db=new PGlite();await db.waitReady;
 await db.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
 await db.exec(schema('V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql'));
 await db.exec(schema('V2-INGREDIENT-CANONICAL-CATALOG-READER-CANDIDATE.sql'));
 await db.exec(`CREATE ROLE allin_ing_catalog_reader_test_v1 LOGIN NOINHERIT NOBYPASSRLS;
 GRANT allin_v2_ingredient_catalog_reader TO allin_ing_catalog_reader_test_v1 WITH INHERIT FALSE, SET TRUE;
 CREATE ROLE catalog_reader_stranger LOGIN NOINHERIT;
 INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,normalized_name,identity_kind,status) VALUES('${ing}','red_onion_raw','Red Onion Raw','red onion raw','generic_food','active');
 INSERT INTO public.v2_ingredient_nutrition_profiles(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,coverage_status,review_status,source_quality,profile_revision,required_nutrient_set_version) VALUES('${p}','${ing}','raw','g',100,'100 g','launch_core_complete','candidate','Foundation',1,'cookbook-launch-macros-v1');
 INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,source_description,source_quality,source_license,payload_sha256,mapping_status) VALUES('${src}','${ing}','usda_fdc','Foundation','790577','Onions, red, raw','foundation_review','CC0','${sha}','mapped');
 INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role) VALUES('${p}','${src}','primary');`);
 return db;
}
const source={source_profile_key:'red_onion_raw',fdcId:790577,source_description:'Onions, red, raw',payload_sha256:sha,proposed_preparation_state:'raw'};
test('restricted reader sees exact candidate mapping and cannot write',async()=>{
 const db=await setup();
 try {
  await db.exec('SET SESSION AUTHORIZATION allin_ing_catalog_reader_test_v1');
  await db.exec('SET ROLE allin_v2_ingredient_catalog_reader');
  const reader={query:(sql,args)=>db.query(sql,args)};
  const mapped=await readCanonicalMappingsFromDatabase({reader,sourceFoods:[source]});
  assert.equal(mapped.canonicalMappings.length,1);
  assert.equal(mapped.canonicalMappings[0].profileId,p);
  assert.equal(mapped.exceptions.length,0);
  await assert.rejects(()=>db.query('UPDATE public.v2_ingredient_nutrition_profiles SET review_status=$1 WHERE id=$2',['reviewed',p]),e=>e.code==='42501');
  const changed=await readCanonicalMappingsFromDatabase({reader,sourceFoods:[{...source,payload_sha256:'f'.repeat(64)}]});
  assert.equal(changed.canonicalMappings.length,0);
  assert.equal(changed.exceptions.length,1);
 } finally {await db.close();}
});
test('athlete and stranger do not get unqualified candidate mapping',async()=>{
 const db=await setup();
 try {
  await db.exec('SET SESSION AUTHORIZATION catalog_reader_stranger');
  await assert.rejects(()=>db.query(CANONICAL_MAPPING_READER_SQL,[['790577']]),e=>e.code==='42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('SET SESSION AUTHORIZATION authenticated');
  const result=await db.query(CANONICAL_MAPPING_READER_SQL,[['790577']]);
  assert.equal(result.rows.length,0);
 } finally {await db.close();}
});
