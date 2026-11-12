'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {inspectRecipe,triageJsonl}=require('./cookbook-review-triage.cjs');
const recipe=(id='recipe-001')=>({
  source_recipe_id:id,source_status:'draft',source_published:true,
  source_origin:'source_adapted_or_user_tested',
  authored_ingredients_review_only:[{item:'Cooked rice',amount:'4 oz cooked'}],
  source_variants_review_only:[{id:'regular',authored_ingredients_review_only:[{item:'Rice',amount:'4 oz'}],instructions:['Cook'],servings:1}],
  source_freezer_kit_review_only:null
});
test('source draft does not become approved despite complete authored text',()=>{
  const item=inspectRecipe(recipe());
  assert.equal(item.publicationApproved,false);
  assert.equal(item.reviewRequired,true);
  assert(item.reasons.includes('source_not_tested'));
  assert(item.reasons.includes('quantity_unit_and_cooked_target_review'));
});
test('freezer kit remains raw workflow separate from cooked-target review',()=>{
  const r=recipe();r.source_freezer_kit_review_only={kind:'raw_kit',freezer_ingredients:[{item:'Chicken',amount:'10 oz raw'}]};
  const item=inspectRecipe(r);
  assert.equal(item.freezerKitCandidate,true);
  assert(item.reasons.includes('freezer_kit_raw_lifecycle_review'));
  assert(!item.reasons.includes('quantity_unit_and_cooked_target_review'));
});
test('flags sparse variants, missing provenance and free-text ingredients without inventing missing data',()=>{
  const r=recipe();r.source_origin=null;r.authored_ingredients_review_only=['Salt to taste'];r.source_variants_review_only=[{id:'budget',instructions:null}];
  const reasons=inspectRecipe(r).reasons;
  assert(reasons.includes('source_origin_missing'));
  assert(reasons.includes('free_text_ingredient_lines'));
  assert(reasons.includes('sparse_version_needs_inheritance_review'));
});
test('rejects missing source identity',()=>assert.throws(()=>inspectRecipe({...recipe(),source_recipe_id:''})));
test('per-file triage detects incomplete count and duplicate IDs',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all218-triage-'));
  try {
    const input=path.join(dir,'recipes.ndjson');
    fs.writeFileSync(input,[recipe(),recipe()].map(r=>JSON.stringify({staged_candidate_json:r})).join('\n')+'\n');
    const result=await triageJsonl(input,{expectedRecipes:2});
    assert.equal(result.publicationApproved,false);
    assert.equal(result.ok,false);
    assert(result.errors.some(e=>e.includes('duplicate source recipe ID')));
    assert(result.errors.some(e=>e.includes('expected 2 recipes')));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('complete candidate count yields triage report but never publication approval',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all218-triage-'));
  try {
    const input=path.join(dir,'recipes.ndjson');
    fs.writeFileSync(input,JSON.stringify(recipe())+'\n');
    const result=await triageJsonl(input,{expectedRecipes:1});
    assert.equal(result.ok,true);
    assert.equal(result.candidateCount,1);
    assert.equal(result.publicationApproved,false);
    assert.equal(result.reviewFlagCounts.image_rights_review,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('routes legacy merged records to source identity review regardless of origin marker',()=>{
  const r=recipe('recipe-396');r.title='[Merged] BBQ Chicken Quesadilla — legacy #379';
  const item=inspectRecipe(r);
  assert.equal(item.reviewLane,'source_identity_and_rights');
  assert(item.reasons.includes('legacy_merge_identity_review'));
  assert.equal(item.publicationApproved,false);
});
test('routes imported-source recipe to ownership review without inferring license',()=>{
  const r=recipe('recipe-import-example');r.title='Imported dish';
  const item=inspectRecipe(r);
  assert.equal(item.reviewLane,'source_identity_and_rights');
  assert(item.reasons.includes('external_import_provenance_review'));
  assert.equal(item.publicationApproved,false);
});
test('routes variant structure work separately from standard measurement review',()=>{
  const r=recipe();r.source_variants_review_only=[{id:'partial'}];
  const item=inspectRecipe(r);
  assert.equal(item.reviewLane,'ingredient_and_variant_structure');
});
test('routes freezer kit to method review when source identity and structure are complete',()=>{
  const r=recipe();r.source_freezer_kit_review_only={kind:'raw_kit'};
  const item=inspectRecipe(r);
  assert.equal(item.reviewLane,'freezer_kit_method');
});
test('source review lane retains highest priority over freezer-kit method',()=>{
  const r=recipe();r.source_origin=null;r.source_freezer_kit_review_only={kind:'raw_kit'};
  assert.equal(inspectRecipe(r).reviewLane,'source_identity_and_rights');
});

test('report orders source ownership before structure, freezer kit and standard work',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all218-priorities-'));
  try {
    const standard=recipe('r-standard');standard.title='Standard recipe';
    const kit=recipe('r-kit');kit.source_freezer_kit_review_only={kind:'raw_kit'};
    const structural=recipe('r-structure');structural.authored_ingredients_review_only=['Salt'];
    const imported=recipe('recipe-import-source');imported.title='Imported recipe';
    const input=path.join(dir,'recipes.ndjson');
    fs.writeFileSync(input,[standard,kit,structural,imported].map(JSON.stringify).join('\n')+'\n');
    const result=await triageJsonl(input,{expectedRecipes:4});
    assert.equal(result.ok,true);
    assert.equal(result.publicationApproved,false);
    assert.deepEqual(result.items.map(r=>r.reviewLane),[
      'source_identity_and_rights','ingredient_and_variant_structure',
      'freezer_kit_method','standard_recipe_measurements'
    ]);
    assert.deepEqual(result.reviewLaneCounts,{
      standard_recipe_measurements:1,freezer_kit_method:1,
      ingredient_and_variant_structure:1,source_identity_and_rights:1
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
