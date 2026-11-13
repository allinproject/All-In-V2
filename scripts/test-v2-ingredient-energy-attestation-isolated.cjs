'use strict';
// ALL-225 / ALL-222 - populated 8-food isolated PostgreSQL attestation tests.
// PGLITE_MODULE=/absolute/path/pglite/dist/index.cjs node --test this-file
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../docs/architecture/sql',p),'utf8');
const cat=read('V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql');
const writer=read('V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql');
const lifecycle=read('V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql');
const attestSql=read('V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql');
const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json'),'utf8'));
const aliasPolicy=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json'),'utf8'));
const digestEvidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json'),'utf8'));
const pinnedDigestByFdc=new Map(digestEvidence.records.map(r=>[r.fdcId,r]));
if(digestEvidence.records.length!==8 || pinnedDigestByFdc.size!==8 ||
   digestEvidence.archiveSha256!==evidence.archiveSha256)
 throw Error('Pinned official USDA per-food energy/digest inventory drift');

const states=new Map(aliasPolicy.records.map(r=>[r.source_profile_key,r.preparation_state]));
const uu=(head,i)=>head+String(i).padStart(12,'0').replace(/^(.{4})(.{4})(.{4})$/,'$1-$2-$3'); // unused outside fixtures
const uuid=(i,group)=>String(group).repeat(8)+'-'+String(group).repeat(4)+'-4'+String(i).padStart(3,'0')+'-8'+String(i).padStart(3,'0')+'-'+String(group).repeat(12);
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const idp="test-idp.example";
const query=(id,sha,rev=3)=>"SELECT allin_private.v2_attest_ingredient_energy("+literal(id)+","+rev+","+literal(sha)+",'Verified official Foundation archive and source energy') AS out";
async function setup(options={}){
 const db=new PGlite();await db.waitReady;
 await db.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
 await db.exec(cat);await db.exec(writer);await db.exec(lifecycle);await db.exec(attestSql);
 await db.exec("CREATE ROLE energy_reviewer_a LOGIN NOINHERIT; GRANT allin_v2_ingredient_reviewer TO energy_reviewer_a");
 await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES('energy_reviewer_a',true,'ISOLATED-ENERGY-ACTOR','test-idp.example','verified-subject-energy-a','vault-test-reference-energy-a',now()-interval '1 hour',now()+interval '1 day')");
 await db.exec("INSERT INTO public.v2_nutrient_definitions(code,display_name,canonical_unit,launch_core,is_published) VALUES('energy_kcal','Energy','kcal',true,true),('protein_g','Protein','g',true,true),('carbohydrate_g','Carbs','g',true,true),('total_fat_g','Total fat','g',true,true),('sodium_mg','Sodium','mg',false,true)");
 let rows=[];
 for(let i=0;i<evidence.records.length;i++){
   const r=evidence.records[i],key=r.profile,identity=uuid(i+1,'1'),profile=uuid(i+1,'2'),source=uuid(i+1,'3');
   const verified=pinnedDigestByFdc.get(r.fdcId);
   if(!verified || verified.selectedFdcNutrientId!==Number(r.energy.code) ||
      verified.selectedEnergyKcal!==r.energy.kcal ||
      !/^[a-f0-9]{64}$/.test(verified.sourcePayloadSha256))
     throw Error('USDA pinned per-food energy/digest mismatch for FDC '+r.fdcId);
   const digest=verified.sourcePayloadSha256;
   const state=states.get(key);assert(state,'missing accepted preparation state');
   await db.exec("INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,normalized_name,identity_kind,status) VALUES("+[identity,key,r.v1,key,'generic_food','active'].map(literal).join(',')+")");
   await db.exec("INSERT INTO public.v2_ingredient_nutrition_profiles(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,coverage_status,review_status,source_quality,profile_revision,required_nutrient_set_version,is_default) VALUES("+[profile,identity,state,'g',100,'100 g','launch_core_complete','reviewed','Foundation',3,'cookbook-launch-macros-v1',false].map(v=>typeof v==='boolean'?String(v):typeof v==='number'?String(v):literal(v)).join(',')+")");
   await db.exec("INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,source_description,source_quality,source_license,payload_sha256,mapping_status) VALUES("+[source,identity,'usda_fdc','Foundation',r.fdcId,r.source,'foundation_review','CC0',digest,'mapped'].map(literal).join(',')+")");
   await db.exec("INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role) VALUES("+[profile,source,'primary'].map(literal).join(',')+")");
   const nutrientRows=[['energy_kcal',r.energy.kcal],['protein_g',r.protein],['carbohydrate_g',r.carbs],['total_fat_g',r.fat],['sodium_mg',r.sodiumMg]];
   for(const [code,amt] of nutrientRows)await db.query('INSERT INTO public.v2_ingredient_profile_nutrients(profile_id,nutrient_code,amount) VALUES($1,$2,$3)',[profile,code,amt]);
   for(const energy of [r.energy,...(r.energy.alternative?[r.energy.alternative]:[])]){
      const nid=Number(energy.code);
      await db.query("INSERT INTO allin_private.v2_ingredient_source_energy_evidence(source_record_id,source_payload_sha256,archive_sha256,fdc_nutrient_id,energy_kcal,source_review_reference) VALUES($1,$2,$3,$4,$5,$6)",[source,digest,options.archiveSha256||evidence.archiveSha256,nid,energy.kcal,'ALL-228 official pinned source test fixture']);
   }
   rows.push({key,id:profile,source,digest,fdc:r.fdcId,energyCode:Number(r.energy.code),energy:r.energy.kcal});
 }
 return {db,rows};
}
test('all eight verified source fixtures attest the selected USDA calorie method without publication',async()=>{
 const {db,rows}=await setup();
 try{
  assert.equal(rows.length,8);
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  for(const row of rows){
   const result=(await db.query(query(row.id,row.digest))).rows[0].out;
   assert.equal(result.status,'attested');
   assert.equal(result.energy_fdc_nutrient_id,row.energyCode);
   assert.equal(Number(result.energy_kcal),row.energy);
   assert.equal(result.calculation_ready,false);
   const replay=(await db.query(query(row.id,row.digest))).rows[0].out;
   assert.equal(replay.status,'already_attested');
  }
  await assert.rejects(()=>db.query("SELECT * FROM allin_private.v2_ingredient_energy_attestations"),e=>e.code==='42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const attested=(await db.query('SELECT selected_fdc_nutrient_id,count(*)::int AS amount FROM allin_private.v2_ingredient_energy_attestations GROUP BY selected_fdc_nutrient_id ORDER BY selected_fdc_nutrient_id')).rows;
  assert.deepEqual(attested.map(x=>[x.selected_fdc_nutrient_id,x.amount]),[[1008,2],[2048,6]]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready'")).rows[0].n,0);
  await assert.rejects(()=>db.exec("UPDATE allin_private.v2_ingredient_energy_attestations SET selected_energy_kcal=0"),e=>e.code==='42501');
  await assert.rejects(()=>db.exec("DELETE FROM allin_private.v2_ingredient_source_energy_evidence"),e=>e.code==='42501');
 }finally{await db.close()}
});
test('stale digest, missing selected source, 2047-only and changed normalized kcal fail closed',async()=>{
 const {db,rows}=await setup();
 try {
  const row=rows.find(x=>x.energyCode===2048),other=rows.find(x=>x.energyCode===1008);
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(row.id,'f'.repeat(64))),e=>e.code==='40001');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  // Remove preferred specific factor using test setup only. 2047 is not permitted
  // to silently substitute; each immutable row remains protected by triggers,
  // so use a new test-only source record/profile rather than modifying evidence.
  await db.exec("UPDATE public.v2_ingredient_profile_nutrients SET amount=999 WHERE profile_id="+literal(row.id)+" AND nutrient_code='energy_kcal'");
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(row.id,row.digest)),e=>e.code==='23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec("UPDATE public.v2_ingredient_nutrition_profiles SET profile_revision=4 WHERE id="+literal(other.id));
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(other.id,other.digest)),e=>e.code==='40001');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const source=rows[0];
  await db.exec("UPDATE public.v2_ingredient_source_records SET payload_sha256=repeat('d',64) WHERE id="+literal(source.source));
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(source.id,source.digest)),e=>e.code==='40001');
 }finally{await db.close()}
});

test('USDA archive pin is mandatory even when source energy values agree',async()=>{
 const {db,rows}=await setup({archiveSha256:'f'.repeat(64)});
 try{
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(rows[0].id,rows[0].digest)),e=>e.code==='23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM allin_private.v2_ingredient_energy_attestations")).rows[0].n,0);
 }finally{await db.close()}
});
test('future IdP verification date never authorizes reviewer',async()=>{
 const {db,rows}=await setup();
 try{
  await db.exec("UPDATE allin_private.v2_ingredient_review_operators SET identity_verified_at=clock_timestamp()+interval '2 hours' WHERE login_role='energy_reviewer_a'");
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(rows[0].id,rows[0].digest)),e=>e.code==='42501');
 }finally{await db.close()}
});
