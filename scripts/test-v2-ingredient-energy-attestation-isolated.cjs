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
   await db.exec("INSERT INTO public.v2_ingredient_nutrition_profiles(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,coverage_status,review_status,source_quality,profile_revision,required_nutrient_set_version,is_default) VALUES("+[profile,identity,state,'g',100,'100 g','launch_core_complete',options.initialCandidate?'candidate':'reviewed','Foundation',options.initialCandidate?1:3,'cookbook-launch-macros-v1',false].map(v=>typeof v==='boolean'?String(v):typeof v==='number'?String(v):literal(v)).join(',')+")");
   await db.exec("INSERT INTO public.v2_ingredient_source_records(id,ingredient_id,provider,source_data_type,external_record_id,source_description,source_quality,source_license,payload_sha256,mapping_status) VALUES("+[source,identity,'usda_fdc','Foundation',r.fdcId,r.source,'foundation_review','CC0',digest,'mapped'].map(literal).join(',')+")");
   await db.exec("INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role) VALUES("+[profile,source,'primary'].map(literal).join(',')+")");
   const nutrientRows=[['energy_kcal',r.energy.kcal],['protein_g',r.protein],['carbohydrate_g',r.carbs],['total_fat_g',r.fat],['sodium_mg',r.sodiumMg]];
   for(const [code,amt] of nutrientRows)await db.query('INSERT INTO public.v2_ingredient_profile_nutrients(profile_id,nutrient_code,amount) VALUES($1,$2,$3)',[profile,code,amt]);
   if(!options.skipSourceEnergyEvidence) {
   for(const energy of [r.energy,...(r.energy.alternative?[r.energy.alternative]:[])]){
      const nid=Number(energy.code);
      await db.query("INSERT INTO allin_private.v2_ingredient_source_energy_evidence(source_record_id,source_payload_sha256,archive_sha256,fdc_nutrient_id,energy_kcal,source_review_reference) VALUES($1,$2,$3,$4,$5,$6)",[source,digest,options.archiveSha256||evidence.archiveSha256,nid,energy.kcal,'ALL-228 official pinned source test fixture']);
   }
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


const release=(row,methods)=>"SELECT allin_private.v2_release_ingredient_source_energy("+
 [row.source,row.digest,evidence.archiveSha256,JSON.stringify(methods),
  'Independently authorized original USDA Foundation archive verification']
  .map((v,i)=>i===3?literal(v)+'::jsonb':literal(v)).join(',')+") AS out";
const methodsFor=row=>{
 const food=evidence.records.find(r=>r.fdcId===row.fdc);
 return [food.energy,...(food.energy.alternative?[food.energy.alternative]:[])]
   .map(energy=>({nutrientId:Number(energy.code),kcal:energy.kcal}));
};
test('independent source officer releases 14 immutable observations and separate reviewer attests 8 without publication',async()=>{
 const {db,rows}=await setup({skipSourceEnergyEvidence:true});
 try {
  await db.exec("CREATE ROLE source_release_officer_a LOGIN NOINHERIT; GRANT allin_v2_ingredient_source_releaser TO source_release_officer_a");
  await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES('source_release_officer_a',true,'SOURCE-OFFICER-ISOLATED','test-idp.example','verified-source-officer-a','vault-isolated-source-officer-a',now()-interval '1 hour',now()+interval '1 day')");
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_a');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  for(const row of rows){
   const first=(await db.query(release(row,methodsFor(row)))).rows[0].out;
   assert.equal(first.status,'released');
   assert.equal(first.evidence_count,row.energyCode===1008?1:2);
   assert.equal(first.calculation_ready,false);
   const replay=(await db.query(release(row,methodsFor(row)))).rows[0].out;
   assert.equal(replay.status,'already_released');
  }
  await assert.rejects(()=>db.query("SELECT * FROM allin_private.v2_ingredient_source_energy_evidence"),e=>e.code==='42501');
  // The source officer must not be able to self-review even if an accidental
  // later role grant adds reviewer membership: reject combined capabilities.
  await db.exec('SET SESSION AUTHORIZATION postgres');
  await db.exec('GRANT allin_v2_ingredient_reviewer TO source_release_officer_a');
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_a');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  await assert.rejects(()=>db.query(release(rows[0],methodsFor(rows[0]))),e=>e.code==='42501');
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(release(rows[0],methodsFor(rows[0]))),e=>e.code==='42501');
  for(const row of rows){
   const result=(await db.query(query(row.id,row.digest))).rows[0].out;
   assert.equal(result.status,'attested');
   assert.equal(result.energy_fdc_nutrient_id,row.energyCode);
   assert.equal(result.calculation_ready,false);
  }
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const counts=(await db.query("SELECT count(*)::int AS c FROM allin_private.v2_ingredient_source_energy_evidence")).rows[0].c;
  assert.equal(counts,14);
  // Database-owned source issuer attribution is immutable and separate
  // from the independently authenticated reviewer's attestation identity.
  const issuers=(await db.query("SELECT source_releaser_db_login::text AS login,count(*)::int AS n FROM allin_private.v2_ingredient_source_energy_evidence GROUP BY 1")).rows;
  assert.deepEqual(issuers,[{login:'source_release_officer_a',n:14}]);
  const reviewers=(await db.query("SELECT reviewer_db_login::text AS login,count(*)::int AS n FROM allin_private.v2_ingredient_energy_attestations GROUP BY 1")).rows;
  assert.deepEqual(reviewers,[{login:'energy_reviewer_a',n:8}]);
  const attestations=(await db.query("SELECT count(*)::int AS c FROM allin_private.v2_ingredient_energy_attestations")).rows[0].c;
  assert.equal(attestations,8);
  assert.equal((await db.query("SELECT count(*)::int AS c FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready'")).rows[0].c,0);
  await assert.rejects(()=>db.exec('DELETE FROM allin_private.v2_ingredient_source_energy_evidence'),e=>e.code==='42501');
 } finally {await db.close()}
});
test('source officer rejects wrong digest, energy, unauthorized login and source revision without any immutable release',async()=>{
 const {db,rows}=await setup({skipSourceEnergyEvidence:true});
 try {
  await db.exec("CREATE ROLE source_release_officer_b LOGIN NOINHERIT; GRANT allin_v2_ingredient_source_releaser TO source_release_officer_b");
  await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES('source_release_officer_b',true,'SOURCE-OFFICER-ISOLATED-B','test-idp.example','verified-source-officer-b','vault-isolated-source-officer-b',now()-interval '1 hour',now()+interval '1 day')");
  const row=rows[2];
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(release(row,methodsFor(row))),e=>e.code==='42501');
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_b');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  await assert.rejects(()=>db.query(release(row,methodsFor(row).map(x=>({...x,kcal:999})))),e=>e.code==='23514');
  await assert.rejects(()=>db.query(release({...row,digest:'f'.repeat(64)},methodsFor(row))),e=>e.code==='23514');
  await assert.rejects(()=>db.query(release(row,[{nutrientId:2047,kcal:31.4}])),e=>e.code==='23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query("SELECT count(*)::int AS c FROM allin_private.v2_ingredient_source_energy_evidence")).rows[0].c,0);
  await db.exec("UPDATE allin_private.v2_ingredient_review_operators SET enabled=false,revoked_at=clock_timestamp() WHERE login_role='source_release_officer_b'");
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_b');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  await assert.rejects(()=>db.query(release(row,methodsFor(row))),e=>e.code==='42501');
 } finally {await db.close()}
});



test('second independent issuer cannot overwrite or relabel already released USDA evidence',async()=>{
 const {db,rows}=await setup({skipSourceEnergyEvidence:true});
 try {
  for(const suffix of ['a','b']){
   await db.exec("CREATE ROLE source_release_officer_"+suffix+" LOGIN NOINHERIT; GRANT allin_v2_ingredient_source_releaser TO source_release_officer_"+suffix);
   await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at) VALUES('source_release_officer_"+suffix+"',true,'SOURCE-OFFICER-ISOLATED-"+suffix+"','test-idp.example','verified-source-issuer-"+suffix+"','vault-isolated-source-issuer-"+suffix+"',now()-interval '1 hour',now()+interval '1 day')");
  }
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_a');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  assert.equal((await db.query(release(rows[0],methodsFor(rows[0])))).rows[0].out.status,'released');
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_b');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  await assert.rejects(()=>db.query(release(rows[0],methodsFor(rows[0]))),e=>e.code==='23514');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.deepEqual((await db.query("SELECT DISTINCT source_releaser_db_login::text AS issuer FROM allin_private.v2_ingredient_source_energy_evidence")).rows,
   [{issuer:'source_release_officer_a'}]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM allin_private.v2_ingredient_source_energy_evidence")).rows[0].n,1);
 }finally{await db.close()}
});
test('accidental dual membership cannot self-attest source evidence',async()=>{
 const {db,rows}=await setup();
 try {
  // Evidence exists, but role separation must be enforced by the database
  // even if an operator mistakenly grants both capabilities to one login.
  await db.exec('GRANT allin_v2_ingredient_source_releaser TO energy_reviewer_a');
  await db.exec('SET SESSION AUTHORIZATION energy_reviewer_a');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(query(rows[0].id,rows[0].digest)),e=>e.code==='42501');
  await assert.rejects(()=>db.query(
    "SELECT allin_private.v2_review_ingredient_profile_status($1,3,$2,'calculation_ready','Dual-role publication must be denied','891b0d4e-499a-46cc-894b-07bdcab7b6a1')",
    [rows[0].id,rows[0].digest]),e=>e.code==='42501');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM allin_private.v2_ingredient_energy_attestations')).rows[0].n,0);
 }finally{await db.close()}
});


test('eight-food canonical bulk seed flows through machine review, independent source energy release and attestation without publishing',async()=>{
 const {db,rows}=await setup({skipSourceEnergyEvidence:true,initialCandidate:true});
 try {
  assert.equal(rows.length,8);
  // Ingestion identities are created in the canonical catalog fixture only.
  // No new table, external API, source-value invention or publisher grant.
  await db.exec("CREATE ROLE allin_ing_workload_eight_ingest_v1 LOGIN NOINHERIT NOBYPASSRLS;"+
   "GRANT allin_v2_ingredient_reviewer TO allin_ing_workload_eight_ingest_v1 WITH INHERIT FALSE, SET TRUE");
  await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators"+
   "(login_role,principal_kind,enabled,enrollment_reference,identity_issuer,identity_subject,"+
   "credential_vault_reference,identity_verified_at,credential_expires_at) VALUES"+
   "('allin_ing_workload_eight_ingest_v1','workload',true,'ISOLATED-EIGHT-INGEST',"+
   "'allin-v2-internal-workload','ingest-eight-fixture','test-vault-reference-eight-ingest',"+
   "now()-interval '1 hour',now()+interval '1 day')");
  await db.exec("CREATE ROLE source_release_officer_eight LOGIN NOINHERIT NOBYPASSRLS;"+
   "GRANT allin_v2_ingredient_source_releaser TO source_release_officer_eight WITH INHERIT FALSE, SET TRUE");
  await db.exec("INSERT INTO allin_private.v2_ingredient_review_operators"+
   "(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,"+
   "credential_vault_reference,identity_verified_at,credential_expires_at) VALUES"+
   "('source_release_officer_eight',true,'ISOLATED-EIGHT-SOURCE',"+
   "'test-idp.example','source-officer-eight-fixture','test-vault-source-officer-eight',"+
   "now()-interval '1 hour',now()+interval '1 day')");
  // Independent source officer alone may release immutable USDA observations.
  await db.exec('SET SESSION AUTHORIZATION source_release_officer_eight');
  await db.exec('SET ROLE allin_v2_ingredient_source_releaser');
  for(const row of rows){
    const released=(await db.query(release(row,methodsFor(row)))).rows[0].out;
    assert.equal(released.status,'released');
    assert.equal(released.calculation_ready,false);
  }
  // The machine reviewer cannot self-release provenance and cannot publish.
  await db.exec('SET SESSION AUTHORIZATION allin_ing_workload_eight_ingest_v1');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(release(rows[0],methodsFor(rows[0]))),
   e=>e.code==='42501');
  for(const [i,row] of rows.entries()){
    for(const [stage,next] of ['needs_review','reviewed'].entries()){
      const expectedRevision=stage+1;
      const idempotency='aaaaaaaa-aaaa-4aaa-8aaa-'+String(i*2+stage+1).padStart(12,'0');
      const result=(await db.query(
       'SELECT allin_private.v2_review_ingredient_profile_status($1::uuid,$2::integer,$3::text,$4::text,$5::text,$6::uuid) AS out',
       [row.id,expectedRevision,row.digest,next,
        'Automatic verified USDA Foundation source qualification test',idempotency]
      )).rows[0].out;
      assert.equal(result.review_status,next);
      assert.equal(result.profile_revision,expectedRevision+1);
      assert.equal(result.status,'reviewed');
    }
    const attested=(await db.query(query(row.id,row.digest,3))).rows[0].out;
    assert.equal(attested.status,'attested');
    assert.equal(attested.energy_fdc_nutrient_id,row.energyCode);
    assert.equal(Number(attested.energy_kcal),row.energy);
    assert.equal(attested.calculation_ready,false);
    const replay=(await db.query(query(row.id,row.digest,3))).rows[0].out;
    assert.equal(replay.status,'already_attested');
  }
  await assert.rejects(()=>db.query(
    'SELECT allin_private.v2_review_ingredient_profile_status($1,3,$2,$3,$4,$5)',
    [rows[0].id,rows[0].digest,'calculation_ready',
     'Unauthorized isolated bulk publication must be denied',
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000077']),
   e=>['0A000','23514','42501'].includes(e.code));
  await db.exec('SET SESSION AUTHORIZATION postgres');
  const statuses=(await db.query(
   'SELECT review_status,profile_revision,count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles GROUP BY 1,2')).rows;
  assert.deepEqual(statuses,[{review_status:'reviewed',profile_revision:3,n:8}]);
  const counts=(await db.query(
   'SELECT (SELECT count(*)::int FROM public.v2_ingredients) ingredients,'+
   '(SELECT count(*)::int FROM public.v2_ingredient_source_records) sources,'+
   '(SELECT count(*)::int FROM public.v2_ingredient_profile_sources) links,'+
   '(SELECT count(*)::int FROM allin_private.v2_ingredient_source_energy_evidence) observations,'+
   '(SELECT count(*)::int FROM allin_private.v2_ingredient_review_events) review_events,'+
   '(SELECT count(*)::int FROM allin_private.v2_ingredient_energy_attestations) attestations,'+
   "(SELECT count(*)::int FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready') published")).rows[0];
  assert.deepEqual(counts,{ingredients:8,sources:8,links:8,observations:14,
   review_events:16,attestations:8,published:0});
  assert.deepEqual((await db.query(
   'SELECT DISTINCT source_releaser_db_login::text AS actor FROM allin_private.v2_ingredient_source_energy_evidence')).rows,
   [{actor:'source_release_officer_eight'}]);
  assert.deepEqual((await db.query(
   'SELECT DISTINCT reviewer_db_login::text AS actor FROM allin_private.v2_ingredient_energy_attestations')).rows,
   [{actor:'allin_ing_workload_eight_ingest_v1'}]);

  // Prepare complete, source-scoped exact alias/default evidence. These are
  // fixture writes by the disposable DB owner, never a public write route.
  await db.exec("UPDATE public.v2_ingredient_nutrition_profiles SET is_default=true WHERE review_status='reviewed'");
  for(const [i,row] of rows.entries()){
    const scope=aliasPolicy.records.find(x=>x.source_profile_key===row.key);
    assert(scope?.exact_alias_candidates?.length>0);
    const name=scope.exact_alias_candidates[0].value.toLowerCase();
    const ingredientId=uuid(i+1,'1'),aliasId=uuid(i+1,'4');
    await db.query(
      'INSERT INTO public.v2_ingredient_aliases(id,ingredient_id,normalized_alias,locale,preparation_state,alias_kind,resolution_scope,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [aliasId,ingredientId,name,'en',scope.preparation_state,'source_description','exact','active']
    );
  }
  await db.exec('SET SESSION AUTHORIZATION allin_ing_workload_eight_ingest_v1');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  await assert.rejects(()=>db.query(
    'SELECT allin_private.v2_review_ingredient_profile_status($1,3,$2,$3,$4,$5)',
    [rows[0].id,rows[0].digest,'calculation_ready',
     'All source facts verified but publisher capability not yet granted',
     'aaaaaaaa-aaaa-4aaa-8aaa-000000000078']),
    e=>e.code==='0A000');
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query(
   "SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready'")).rows[0].n,0);
  // This authorization exists exclusively inside disposable PGlite. Production
  // must never infer publisher permission from source attestation or test PASS.
  await db.exec('GRANT allin_v2_ingredient_publisher TO allin_ing_workload_eight_ingest_v1 WITH INHERIT FALSE, SET TRUE');
  await db.exec('SET SESSION AUTHORIZATION allin_ing_workload_eight_ingest_v1');
  await db.exec('SET ROLE allin_v2_ingredient_reviewer');
  for(const [i,row] of rows.entries()){
    const argumentsFor=[row.id,3,row.digest,'calculation_ready',
      'Controlled test-only publication after all independent source and nutrient gates',
      'aaaaaaaa-aaaa-4aaa-8aaa-'+String(i+41).padStart(12,'0')];
    const statement='SELECT allin_private.v2_review_ingredient_profile_status($1::uuid,$2::integer,$3::text,$4::text,$5::text,$6::uuid) AS out';
    const published=(await db.query(statement,argumentsFor)).rows[0].out;
    assert.equal(published.review_status,'calculation_ready');
    assert.equal(published.profile_revision,4);
    assert.equal((await db.query(statement,argumentsFor)).rows[0].out.status,'replayed');
  }
  await db.exec('SET SESSION AUTHORIZATION postgres');
  assert.equal((await db.query(
    "SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready'")).rows[0].n,8);
  assert.equal((await db.query(
    'SELECT count(*)::int AS n FROM allin_private.v2_ingredient_review_events')).rows[0].n,24);
  await db.exec('SET SESSION AUTHORIZATION authenticated');
  assert.equal((await db.query(
    'SELECT count(*)::int AS n FROM public.v2_ingredient_nutrition_profiles')).rows[0].n,8);
  await assert.rejects(()=>db.query(
    "UPDATE public.v2_ingredient_nutrition_profiles SET review_status='retired'"),
    e=>e.code==='42501');
 }finally{await db.close()}
});
