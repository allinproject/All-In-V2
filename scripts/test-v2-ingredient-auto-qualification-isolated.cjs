'use strict';
// ALL-228: disposable PGlite execution of existing canonical writer through
// automatic source admission. Never reaches Supabase or production.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.cjs node --test this-file
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {runAutomaticQualification}=require('./run-v2-ingredient-auto-qualification.cjs');
const read=name=>fs.readFileSync(path.join(__dirname,'../docs/architecture/sql/',name),'utf8');
const PROFILE='22222222-2222-4222-8222-222222222222';
const SOURCE='33333333-3333-4333-8333-333333333333';
const ING='11111111-1111-4111-8111-111111111111';
const key='black_beans_canned_drained';
const nutrient=(id,amount,unitName='g')=>({nutrient:{id,unitName},amount});
function input(){
 const payload_utf8=JSON.stringify({provider:'usda_fdc',dataType:'Foundation',fdcId:2644285,
   basis_quantity:100,basis_unit:'g',
   foodNutrients:[nutrient(2048,115,'kcal'),nutrient(1003,6.91),
     nutrient(1005,19.8),nutrient(1004,1.27)]});
 const digest=createHash('sha256').update(payload_utf8).digest('hex');
 return {profileId:PROFILE,expectedRevision:1,sourceProfileKey:key,digest,
   candidates:[{source_profile_key:key,canonical_name:'Black beans, canned drained',
     identity_kind:'generic_food',preparation_state:'cooked_drained',locale:'en',
     aliases:['Canned black beans drained'],sources:[
       {provider:'usda_fdc',source_data_type:'Foundation',external_record_id:'2644285'}]}],
   documents:[{source_profile_key:key,payload_utf8,payload_sha256:digest}]};
}
async function setup({withEnergyEvidence=true,archiveDigest='dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579'}={}){
 const db=new PGlite();
 await db.waitReady;
 await db.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
 await db.exec(read('V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql'));
 await db.exec(read('V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql'));
 await db.exec(read('V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql'));
 await db.exec(read('V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql'));
 const x=input();
 await db.exec('CREATE ROLE allin_ing_workload_food_ingest_v1 LOGIN NOINHERIT;'+
   'GRANT allin_v2_ingredient_reviewer TO allin_ing_workload_food_ingest_v1 WITH INHERIT FALSE, SET TRUE;');
 // Synthetic operator identity is confined to this ephemeral database; it is
 // NOT a real IdP enrollment or permission to deploy reviewer credentials.
 await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators"+
   "(login_role,principal_kind,enabled,enrollment_reference,identity_issuer,identity_subject,"+
   "credential_vault_reference,identity_verified_at,credential_expires_at) VALUES"+
   "('allin_ing_workload_food_ingest_v1','workload',true,'LOCAL-TEST-ONLY','allin-v2-internal-workload',"+
   "'ingest-isolated-test-v1','test-vault-reference-not-a-secret',"+
   "now()-interval '1 hour',now()+interval '1 day');");
 await db.exec("INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,"+
   "normalized_name,identity_kind,status) VALUES ('"+ING+"','"+key+"',"+
   "'Black beans canned drained','black beans canned drained','generic_food','active');");
 await db.exec("INSERT INTO public.v2_ingredient_nutrition_profiles"+
   "(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,"+
   "review_status,profile_revision,coverage_status,source_quality,required_nutrient_set_version)"+
   "VALUES('"+PROFILE+"','"+ING+"','cooked_drained','g',100,'100 g','candidate',1,"+
   "'launch_core_complete','foundation','cookbook-launch-macros-v1');");
 await db.exec("INSERT INTO public.v2_ingredient_source_records"+
   "(id,ingredient_id,provider,source_data_type,external_record_id,source_description,"+
   "source_quality,source_license,mapping_status,payload_sha256) VALUES('"+SOURCE+"',"+
   "'"+ING+"','usda_fdc','Foundation','2644285','Beans, black, canned drained',"+
   "'foundation','CC0','mapped','"+x.digest+"');");
 await db.exec("INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role)"+
   " VALUES('"+PROFILE+"','"+SOURCE+"','primary');");
 await db.exec("INSERT INTO public.v2_nutrient_definitions(code,display_name,canonical_unit,launch_core,is_published) VALUES"+
   "('energy_kcal','Energy','kcal',true,true),('protein_g','Protein','g',true,true),"+
   "('carbohydrate_g','Carbohydrate','g',true,true),('total_fat_g','Fat','g',true,true);");
 await db.exec("INSERT INTO public.v2_ingredient_profile_nutrients(profile_id,nutrient_code,amount) VALUES"+
   "('"+PROFILE+"','energy_kcal',115),('"+PROFILE+"','protein_g',6.91),"+
   "('"+PROFILE+"','carbohydrate_g',19.8),('"+PROFILE+"','total_fat_g',1.27);");
 // Privileged source-release fixture, NOT a caller-provided energy claim.
 if(withEnergyEvidence)await db.exec("INSERT INTO allin_private.v2_ingredient_source_energy_evidence"+
   "(source_record_id,source_payload_sha256,archive_sha256,fdc_nutrient_id,energy_kcal,source_review_reference)"+
   " VALUES('"+SOURCE+"','"+x.digest+"','"+archiveDigest+"',"+
   "2048,115,'ISOLATED-TEST-ARCHIVE-ONLY');");
 await db.exec('SET SESSION AUTHORIZATION allin_ing_workload_food_ingest_v1;SET ROLE allin_v2_ingredient_reviewer;');
 return {db,x};
}
test('actual PostgreSQL transaction: rollback, two immutable events, idempotent replay',async()=>{
 const {db,x}=await setup();
 try {
   let calls=0;
   const interrupted={query:async(sql,args)=>{
     if(sql.includes('v2_review_ingredient_profile_status')&&++calls===2)
       throw Error('simulated second statement failure');
     return db.query(sql,args);
   }};
   await assert.rejects(runAutomaticQualification({client:interrupted,...x}),/simulated second/);
   await db.exec('SET SESSION AUTHORIZATION postgres');
   let row=(await db.query("SELECT review_status,profile_revision FROM public.v2_ingredient_nutrition_profiles WHERE id='"+PROFILE+"'")).rows[0];
   assert.equal(row.review_status,'candidate');assert.equal(row.profile_revision,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_review_events')).rows[0].n,0);
   await db.exec('SET SESSION AUTHORIZATION allin_ing_workload_food_ingest_v1;SET ROLE allin_v2_ingredient_reviewer;');
   const success=await runAutomaticQualification({client:db,...x,attestEnergy:true});
   assert.equal(success.status,'source_qualified_not_published');
   assert.equal(success.publicationApproved,false);
   assert.equal(success.energyAttestation.status,'attested');
   const replay=await runAutomaticQualification({client:db,...x,attestEnergy:true});
   assert(replay.events.every(e=>e.status==='replayed'));
   assert.equal(replay.energyAttestation.status,'already_attested');
   await db.exec('SET SESSION AUTHORIZATION postgres');
   row=(await db.query("SELECT review_status,profile_revision FROM public.v2_ingredient_nutrition_profiles WHERE id='"+PROFILE+"'")).rows[0];
   assert.equal(row.review_status,'reviewed');assert.equal(row.profile_revision,3);
   const events=(await db.query('SELECT previous_status,next_status FROM allin_private.v2_ingredient_review_events ORDER BY event_id')).rows;
   assert.deepEqual(events.map(e=>e.previous_status+'>'+e.next_status),
     ['candidate>needs_review','needs_review>reviewed']);
   // Workload cannot publish or perform human exception decisions even with
   // an enabled operator registry row and valid restricted role membership.
   await db.exec('SET SESSION AUTHORIZATION allin_ing_workload_food_ingest_v1;SET ROLE allin_v2_ingredient_reviewer;');
   await assert.rejects(
     db.query("SELECT allin_private.v2_review_ingredient_profile_status('"+PROFILE+"',3,'"+x.digest+"','calculation_ready','Simulated machine publication denial','44444444-4444-4444-8444-444444444444')"),
     e=>e?.code==='42501');
   await assert.rejects(
     db.query("SELECT allin_private.v2_review_ingredient_profile_status('"+PROFILE+"',3,'"+x.digest+"','retired','Simulated machine retirement denial','55555555-5555-4555-8555-555555555555')"),
     e=>e?.code==='42501');
   const attestAgain=(await db.query(
     "SELECT allin_private.v2_attest_ingredient_energy('"+PROFILE+"',3,'"+x.digest+"','Safe replay of immutable source evidence') AS result")).rows[0].result;
   assert.equal(attestAgain.status,'already_attested');
   await assert.rejects(db.query('SELECT * FROM allin_private.v2_ingredient_review_events'),
     e=>e?.code==='42501');
   await db.exec('SET SESSION AUTHORIZATION postgres');
   const auditAfter=(await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_review_events')).rows[0].n;
   assert.equal(auditAfter,2);
   const stored=(await db.query(
     'SELECT selected_fdc_nutrient_id,selected_energy_kcal FROM allin_private.v2_ingredient_energy_attestations')).rows;
   assert.equal(stored.length,1);
   assert.equal(stored[0].selected_fdc_nutrient_id,2048);
   assert.equal(Number(stored[0].selected_energy_kcal),115);

   const final=(await db.query("SELECT review_status,profile_revision FROM public.v2_ingredient_nutrition_profiles WHERE id='"+PROFILE+"'")).rows[0];
   assert.equal(final.review_status,'reviewed');assert.equal(final.profile_revision,3);
   // Bad workload claims cannot pass the canonical registry constraint.
   await assert.rejects(db.query(
     "INSERT INTO allin_private.v2_ingredient_review_operators(login_role,principal_kind,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES('bad_workload','workload',true,'LOCAL-TEST-ONLY','untrusted-issuer','ingest-fake-subject','test-vault-reference-unsafe',now(),now()+interval '1 day')"),
     e=>e?.code==='23514');

 } finally {await db.close()}
});

test('missing or unapproved source archive aborts machine review and rolls back every audit event',async()=>{
 for(const scenario of [{withEnergyEvidence:false},{archiveDigest:'f'.repeat(64)}]) {
   const {db,x}=await setup(scenario);
   try {
     await assert.rejects(
       runAutomaticQualification({client:db,...x,attestEnergy:true}),
       /missing source archive evidence|unapproved USDA Foundation archive revision/);
     await db.exec('SET SESSION AUTHORIZATION postgres');
     const row=(await db.query("SELECT review_status,profile_revision FROM public.v2_ingredient_nutrition_profiles WHERE id='"+PROFILE+"'")).rows[0];
     assert.equal(row.review_status,'candidate');
     assert.equal(row.profile_revision,1);
     assert.equal((await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_review_events')).rows[0].n,0);
     assert.equal((await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_energy_attestations')).rows[0].n,0);
   }finally{await db.close()}
 }
});
