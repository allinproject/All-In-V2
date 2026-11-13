'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const read=n=>fs.readFileSync(path.join(__dirname,'../docs/architecture/sql',n),'utf8');
const SOURCE='0b8fc2d591a88381aa11cf0e3041f3b3f30ef4a660d68f74e3f483214f6d8b51';
const ARCHIVE='dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579';
const core={energy_kcal:44,protein_g:0.94,carbohydrate_g:9.93,total_fat_g:0.1,sodium_mg:1};
const reviewer='usda_seed_worker_test',issuer='usda_seed_issuer_test';
const release='SELECT allin_private.v2_release_ingredient_source_core($1,$2,$3,$4::jsonb) AS r';
const insert='SELECT allin_private.v2_seed_ingredient_candidate($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) AS r';
const args=x=>['ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','red_onion_raw','Red Onion - Raw','raw','790577','Onions, red, raw',SOURCE,ARCHIVE,JSON.stringify(x)];
async function dbSetup(){
 const db=new PGlite();await db.waitReady;
 await db.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
 for(const n of ['V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql','V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql','V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql','V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql','V2-INGREDIENT-CANONICAL-SEED-WRITER-CANDIDATE.sql'])await db.exec(read(n));
 await db.exec('CREATE ROLE '+reviewer+' LOGIN NOINHERIT;CREATE ROLE '+issuer+' LOGIN NOINHERIT;GRANT allin_v2_ingredient_reviewer TO '+reviewer+' WITH INHERIT FALSE,SET TRUE;GRANT allin_v2_ingredient_source_releaser TO '+issuer+' WITH INHERIT FALSE,SET TRUE');
 for(const [login,principal,issuerName] of [[issuer,'human','test-idp.example'],[reviewer,'workload','allin-v2-internal-workload']])
  await db.query("INSERT INTO allin_private.v2_ingredient_review_operators(login_role,principal_kind,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES($1,$2,true,'TEST-CANONICAL-SEED',$3,'test-verified-operator','test-vault-ref-seed',now()-interval '1 hour',now()+interval '1 day')",[login,principal,issuerName]);
 await db.exec("INSERT INTO public.v2_nutrient_definitions(code,display_name,canonical_unit,launch_core,is_published) VALUES('energy_kcal','Energy','kcal',true,false),('protein_g','Protein','g',true,false),('carbohydrate_g','Carbs','g',true,false),('total_fat_g','Fat','g',true,false),('sodium_mg','Sodium','mg',false,false)");
 return db;
}
async function as(db,login,role){await db.exec('SET SESSION AUTHORIZATION '+login+';SET ROLE '+role);}
test('independent USDA core release enforces five stored values and candidate-only insertion',async()=>{
 const db=await dbSetup();try{
 await as(db,issuer,'allin_v2_ingredient_source_releaser');
 assert.equal((await db.query(release,['790577',SOURCE,ARCHIVE,JSON.stringify(core)])).rows[0].r.status,'released');
 await as(db,reviewer,'allin_v2_ingredient_reviewer');
 const done=(await db.query(insert,args(core))).rows[0].r;
 assert.equal(done.status,'candidate_seeded');assert.equal(done.calculation_ready,false);
 assert.equal((await db.query(insert,args(core))).rows[0].r.status,'already_seeded');
 await db.exec('SET SESSION AUTHORIZATION postgres');
 const facts=(await db.query('SELECT nutrient_code,amount FROM public.v2_ingredient_profile_nutrients')).rows;
 assert.deepEqual(Object.fromEntries(facts.map(r=>[r.nutrient_code,Number(r.amount)])),core);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready'")).rows[0].n,0);
 }finally{await db.close()}
});
test('unreleased and mismatched nutrient submissions fail with zero candidate writes',async()=>{
 const db=await dbSetup();try{
 await as(db,reviewer,'allin_v2_ingredient_reviewer');
 await assert.rejects(()=>db.query(insert,args(core)),e=>e.code==='23514');
 await as(db,issuer,'allin_v2_ingredient_source_releaser');
 await db.query(release,['790577',SOURCE,ARCHIVE,JSON.stringify(core)]);
 await as(db,reviewer,'allin_v2_ingredient_reviewer');
 await assert.rejects(()=>db.query(insert,args({...core,protein_g:99})),e=>e.code==='23514');
 await db.exec('SET SESSION AUTHORIZATION postgres');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.v2_ingredients')).rows[0].n,0);
 }finally{await db.close()}
});
