'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {reviewUsdaAdmission}=require('./review-v2-usda-source-admission.cjs');
// This requires Node 22 --experimental-strip-types to execute the actual V2
// read adapter and actual TypeScript calculator. No test-only duplicate math.
const {calculateRecipeFromLocalCatalog}=require('../apps/mobile-v2/src/features/cookbook/localIngredientProfiles.ts');
const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json'),'utf8'));
const bindings=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
const aliases=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json'),'utf8'));
const n=(id,amount,unitName='g')=>({nutrient:{id,unitName},amount});
const fixtureFoods=()=>evidence.records.map(r=>({
  source_profile_key:r.profile,provider:'usda_fdc',dataType:'Foundation',
  fdcId:r.fdcId,source_description:r.source,archive_sha256:evidence.archiveSha256,
  basis_quantity:100,basis_unit:'g',
  foodNutrients:[n(Number(r.energy.code),r.energy.kcal,'kcal'),
    ...(r.energy.alternative?[n(Number(r.energy.alternative.code),r.energy.alternative.kcal,'kcal')]:[]),
    n(1003,r.protein),n(1005,r.carbs),n(1004,r.fat),n(1093,r.sodiumMg,'mg')]
}));
const run=(foods=fixtureFoods(),overrides={})=>reviewUsdaAdmission({
  sourceEvidence:evidence,sourceBindings:bindings,aliasPolicy:aliases,sourceFoods:foods,...overrides
});
test('eight USDA summaries pass full source+binding+alias preflight without writer admission',()=>{
  const result=run();
  assert.equal(result.status,'review_stage_complete');
  assert.equal(result.sourceCount,8);
  assert.equal(result.sourceRows.length,8);
  assert.equal(result.issues.length,0);
  assert.equal(result.sourceContractValidated,true);
  assert.equal(result.aliasContractValidated,true);
  assert.equal(result.authorizedToWrite,false);
  assert.equal(result.calculationReady,false);
  for(const row of result.sourceRows){
    assert.equal(row.canonical_identity_id,null);
    assert.equal(row.profile_review_status,'needs_review');
    assert.equal(row.source_preflight_pass,true);
    assert.equal(row.calculationReady,false);
  }
});
test('wrong source nutrient, wrong energy method and source-fdc ID fail the joined review',()=>{
  const bad=fixtureFoods();bad[0].foodNutrients.find(x=>x.nutrient.id===1008).amount=83;
  assert(run(bad).issues.some(x=>x.startsWith('source_value_mismatch:milk_cottage_2pct')));
  const missing=fixtureFoods();missing[3].foodNutrients=missing[3].foodNutrients.filter(x=>x.nutrient.id!==2048);
  assert(run(missing).issues.some(x=>x.startsWith('energy_method_or_version_mismatch:black_beans_canned_drained')));
  const wrong=fixtureFoods();wrong[2].fdcId=123456;
  assert(run(wrong).issues.some(x=>x.startsWith('source_provenance_mismatch:cabbage_green_raw')));
});
test('tampered source or alias policy never enters the review-stage-complete path',()=>{
  const wrongHash={...evidence,archiveSha256:'0'.repeat(64)};
  assert.equal(run(fixtureFoods(),{sourceEvidence:wrongHash}).status,'review_required');
  const changed=JSON.parse(JSON.stringify(aliases));
  changed.records[1].preparation_state='cooked';
  assert.equal(run(fixtureFoods(),{aliasPolicy:changed}).status,'review_required');
});
test('real local read adapter and recipe calculator remain blocked for review-only source data',()=>{
  const reviewed=run();
  const ingredient=reviewed.sourceRows.find(r=>r.source_profile_key==='black_beans_canned_drained');
  const catalog={
    ingredients:[{id:'staging-black-beans',status:'active'}],
    aliases:[{ingredient_id:'staging-black-beans',normalized_alias:'black beans, canned, sodium added, drained and rinsed',
      locale:'en',preparation_state:'cooked_drained',status:'active'}],
    profiles:[{id:'staging-source-only',ingredient_id:'staging-black-beans',
      preparation_state:'cooked_drained',basis_unit:'g',basis_quantity:100,basis_label:'100 g',
      profile_revision:1,review_status:ingredient.profile_review_status,is_default:true,
      source_record_id:ingredient.fdc_id}],
    nutrients:Object.entries(ingredient.reviewed_nutrient_candidates)
      .filter(([key,val])=>['energy_kcal','protein_g','carbohydrate_g','total_fat_g'].includes(key)&&val!=null)
      .map(([nutrient_code,amount])=>({profile_id:'staging-source-only',nutrient_code,amount}))
  };
  const request={line_id:'beans',label:'black beans, canned, sodium added, drained and rinsed',
    preparation_state:'cooked_drained',quantity_g:150};
  const blocked=calculateRecipeFromLocalCatalog({catalog,recipe_id:'staging-recipe',
    recipe_state_version:'1',servings:2,ingredients:[request]});
  assert.equal(blocked.status,'insufficient_evidence');
  assert(blocked.reasons.includes('local_ingredient_review_required:beans'));

  // A wholly isolated TEST-ONLY catalog with an explicitly simulated
  // reviewed writer state checks the actual runtime math (not an approval).
  const hypothetical=JSON.parse(JSON.stringify(catalog));
  hypothetical.profiles[0].review_status='calculation_ready';
  const calculated=calculateRecipeFromLocalCatalog({catalog:hypothetical,
    recipe_id:'staging-recipe',recipe_state_version:'1',servings:2,ingredients:[request]});
  assert.equal(calculated.status,'validated');
  assert.equal(calculated.calories_kcal,86.25); // 115 kcal/100g *150g /2
  assert.equal(calculated.protein_g,5.183);
  assert.equal(calculated.carbs_g,14.85);
  assert.equal(calculated.fat_g,0.953);
  assert.equal(calculated.provenance[0].source.source_record_id,ingredient.fdc_id);
  assert.equal(reviewed.authorizedToWrite,false); // test simulation cannot promote the source
});
test('wrong state and unqualified search term never resolve a reviewed staging profile',()=>{
  const data=run().sourceRows.find(r=>r.source_profile_key==='beans_kidney_canned_drained');
  const catalog={
    ingredients:[{id:'staging-kidney',status:'active'}],
    aliases:[{ingredient_id:'staging-kidney',
      normalized_alias:'kidney beans, dark red, canned, sodium added, sugar added, drained and rinsed',
      locale:'en',preparation_state:'cooked_drained',status:'active'}],
    profiles:[{id:'staging-kidney-profile',ingredient_id:'staging-kidney',preparation_state:'cooked_drained',
      basis_unit:'g',basis_quantity:100,basis_label:'100g',profile_revision:1,
      review_status:'needs_review',is_default:true,source_record_id:data.fdc_id}],
    nutrients:[]
  };
  const recipe=(label,state)=>calculateRecipeFromLocalCatalog({catalog,recipe_id:'test',
    recipe_state_version:1,servings:1,ingredients:[{line_id:'kidney',
      label,preparation_state:state,quantity_g:100}]});
  assert.equal(recipe('kidney beans','cooked_drained').status,'insufficient_evidence');
  assert(recipe('kidney beans','cooked_drained').reasons.includes('local_ingredient_missing:kidney'));
  assert(recipe('kidney beans, dark red, canned, sodium added, sugar added, drained and rinsed','raw').reasons.includes('local_ingredient_missing:kidney'));
});
