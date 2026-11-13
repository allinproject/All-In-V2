'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {stableId,planInitialUSDASeed,executeInitialUSDASeed,RELEASE_CORE,INSERT_CANDIDATE}=require('./run-v2-ingredient-initial-seed.cjs');
const load=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence',n),'utf8'));
const sourceEvidence=load('ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json');
const sourceBindings=load('ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json');
const aliasPolicy=load('ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json');
const nutrient=(id,amount,unitName='g')=>({nutrient:{id,unitName},amount});
const sourceFoods=()=>sourceEvidence.records.map(r=>({
 source_profile_key:r.profile,provider:'usda_fdc',dataType:'Foundation',fdcId:r.fdcId,
 source_description:r.source,archive_sha256:sourceEvidence.archiveSha256,
 payload_sha256:sourceBindings.bindings.find(x=>x.source_profile_key===r.profile).nutrition_evidence.source_payload_sha256_verified,
 basis_quantity:100,basis_unit:'g',
 foodNutrients:[nutrient(Number(r.energy.code),r.energy.kcal,'kcal'),
  ...(r.energy.alternative?[nutrient(Number(r.energy.alternative.code),r.energy.alternative.kcal,'kcal')]:[]),
  nutrient(1003,r.protein),nutrient(1005,r.carbs),nutrient(1004,r.fat),nutrient(1093,r.sodiumMg,'mg')]
}));
const input=()=>({sourceFoods:sourceFoods(),sourceEvidence,sourceBindings,aliasPolicy});
test('verified eight-food source admission yields 8 deterministic immutable candidate requests with five source values',()=>{
 const a=planInitialUSDASeed(input()),b=planInitialUSDASeed(input());
 assert.deepEqual(a,b);
 assert.equal(a.rows.length,8);
 assert.equal(a.calculationReady,false);assert.equal(a.publicationApproved,false);
 assert.equal(new Set(a.rows.map(r=>r.seedArgs[1])).size,8);
 assert.equal(new Set(a.rows.map(r=>r.seedArgs[2])).size,8);
 assert.equal(new Set(a.rows.map(r=>r.seedArgs[3])).size,8);
 for(const row of a.rows){
  const facts=JSON.parse(row.seedArgs[11]);
  const source=sourceEvidence.records.find(e=>String(e.fdcId)===row.fdc_id);
  assert.deepEqual(facts,{
   energy_kcal:source.energy.kcal,protein_g:source.protein,
   carbohydrate_g:source.carbs,total_fat_g:source.fat,sodium_mg:source.sodiumMg
  });
  assert.equal(row.seedArgs[10],sourceEvidence.archiveSha256);
  assert.equal(row.sourceReleaseArgs[3],row.seedArgs[11]);
 }
 assert.match(stableId('ingredient','red_onion_raw','790577'),/^[a-f0-9-]{36}$/);
});
test('bad macro, source digest or alias form blocks every SQL call',async()=>{
 const bad=input();bad.sourceFoods[0].foodNutrients.find(x=>x.nutrient.id===1003).amount=999;
 assert.throws(()=>planInitialUSDASeed(bad),/blocked/);
 const badDigest=input();badDigest.sourceFoods[1].payload_sha256='f'.repeat(64);
 assert.throws(()=>planInitialUSDASeed(badDigest),/blocked/);
 const badAlias=input();badAlias.aliasPolicy=JSON.parse(JSON.stringify(aliasPolicy));
 badAlias.aliasPolicy.records[1].preparation_state='cooked';
 assert.throws(()=>planInitialUSDASeed(badAlias),/blocked/);
 const calls=[];
 const client={query:async()=>{calls.push('unexpected');throw Error('unreachable')}};
 await assert.rejects(executeInitialUSDASeed({
  sourceOfficer:client,seedReviewer:client,...input()
 }),/Independent trusted/);
 assert.deepEqual(calls,[]);
});
test('trusted independent source officer releases first, existing seed function inserts only candidates',async()=>{
 const events=[],officer={query:async(sql,args)=>{
  assert.equal(sql,RELEASE_CORE);events.push('release:'+args[0]);
  return {rows:[{result:{status:'released',calculation_ready:false}}]};
 }},reviewer={query:async(sql,args)=>{
  assert.equal(sql,INSERT_CANDIDATE);events.push('seed:'+args[7]);
  return {rows:[{result:{status:'candidate_seeded',calculation_ready:false}}]};
 }};
 const result=await executeInitialUSDASeed({sourceOfficer:officer,seedReviewer:reviewer,...input()});
 assert.equal(result.status,'candidate_seeded_not_published');
 assert.equal(result.released.length,8);assert.equal(result.seeded.length,8);
 assert.equal(result.calculationReady,false);assert.equal(result.publicationApproved,false);
 assert(events.slice(0,8).every(x=>x.startsWith('release:')));
 assert(events.slice(8).every(x=>x.startsWith('seed:')));
});
test('source officer refusing or returning invalid receipt halts before any canonical seed call',async()=>{
 let writes=0;
 const officer={query:async()=>({rows:[{result:{status:'failed',calculation_ready:false}}]})};
 const reviewer={query:async()=>{writes++;return {rows:[]}}};
 await assert.rejects(executeInitialUSDASeed({sourceOfficer:officer,seedReviewer:reviewer,...input()}),/refused/);
 assert.equal(writes,0);
});
