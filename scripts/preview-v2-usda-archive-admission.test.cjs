'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {previewSourceFoods}=require('./preview-v2-usda-archive-admission.cjs');
const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json'),'utf8'));
const digest=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json'),'utf8'));
const n=(id,amount,unitName='g')=>({nutrient:{id,unitName},amount});
const sample=()=>evidence.records.map(r=>({
  source_profile_key:r.profile,provider:'usda_fdc',dataType:'Foundation',
  fdcId:r.fdcId,source_description:r.source,archive_sha256:evidence.archiveSha256,
  payload_sha256:digest.records.find(d=>d.fdcId===r.fdcId).sourcePayloadSha256,
  basis_quantity:100,basis_unit:'g',
  foodNutrients:[n(Number(r.energy.code),r.energy.kcal,'kcal'),
    ...(r.energy.alternative?[n(Number(r.energy.alternative.code),r.energy.alternative.kcal,'kcal')]:[]),
    n(1003,r.protein),n(1004,r.fat),n(1005,r.carbs),n(1093,r.sodiumMg,'mg')]
}));
test('existing canonical admission produces deterministic review-only summary for eight pinned source fixtures',()=>{
  const r=previewSourceFoods(sample());
  assert.equal(r.status,'review_stage_complete');
  assert.equal(r.sourceCount,8);
  assert.equal(r.passedPreflight,8);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.sourceContractValidated,true);
  assert.equal(r.aliasContractValidated,true);
  assert.equal(r.canonicalIdsAssigned,false);
  assert.equal(r.writerAuthorized,false);
  assert.equal(r.calculationReady,false);
  assert.equal(r.publicationApproved,false);
});
test('source digest mismatch and missing nutrient reject entire review transport',()=>{
  const foods=sample();
  foods[1].payload_sha256='f'.repeat(64);
  let r=previewSourceFoods(foods);
  assert.equal(r.status,'review_required');
  assert.equal(r.passedPreflight,7);
  assert(r.issues.includes('source_digest_reference_mismatch:red_onion_raw'));
  foods[1].payload_sha256=digest.records.find(x=>x.fdcId===foods[1].fdcId).sourcePayloadSha256;
  foods[1].foodNutrients=foods[1].foodNutrients.filter(x=>x.nutrient.id!==1003);
  r=previewSourceFoods(foods);
  assert.equal(r.status,'review_required');
  assert.equal(r.passedPreflight,7);
  assert(r.issues.some(i=>i.includes('nutrient:red_onion_raw:missing_protein_g')));
  assert.equal(r.writerAuthorized,false);
});
test('missing source, repeated source or altered form cannot pass admission',()=>{
  assert.throws(()=>previewSourceFoods(sample().slice(0,7)),/eight/);
  const foods=sample();
  foods[7]={...foods[6]};
  let r=previewSourceFoods(foods);
  assert.equal(r.status,'review_required');
  assert(r.issues.includes('duplicate_or_invalid_source_food'));
  const wrong=sample();
  wrong[0].source_description='Cottage cheese, wrong fat percentage';
  r=previewSourceFoods(wrong);
  assert.equal(r.status,'review_required');
  assert.equal(r.passedPreflight,7);
  assert.equal(r.publicationApproved,false);
});
