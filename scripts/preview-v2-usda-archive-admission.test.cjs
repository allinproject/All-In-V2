'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {previewSourceFoods,previewVerifiedSeedPlan}=require('./preview-v2-usda-archive-admission.cjs');
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

test('dry-run plan uses canonical seed reconciler and is stable across exact replay',async()=>{
  const first=await previewVerifiedSeedPlan(sample());
  assert.equal(first.seedPlanStatus,'dry_run_only');
  assert.equal(first.seedCounts.candidate_insert,8);
  assert.equal(first.seedCounts.unchanged,0);
  assert.equal(first.seedCounts.conflict,0);
  assert.equal(first.canonicalIdsAssigned,false);
  assert.equal(first.writerAuthorized,false);
  assert.equal(first.publicationApproved,false);
  const existing=sample().map(f=>({
    provider:'usda_fdc',source_data_type:'Foundation',
    external_record_id:String(f.fdcId),payload_sha256:f.payload_sha256,
    ingredient_id:null,
  }));
  const repeat=await previewVerifiedSeedPlan(sample(),{existing});
  assert.equal(repeat.seedCounts.unchanged,8);
  assert.equal(repeat.seedCounts.candidate_insert,0);
  const changed=existing.map(f=>({...f}));
  changed[0].payload_sha256='f'.repeat(64);
  const drift=await previewVerifiedSeedPlan(sample(),{existing:changed});
  assert.equal(drift.seedCounts.review_changed_source,1);
  assert.equal(drift.seedCounts.unchanged,7);
  assert.equal(drift.writerAuthorized,false);
});
test('rejected source cannot produce a seed plan',async()=>{
  const food=sample();
  food[0].payload_sha256='0'.repeat(64);
  const result=await previewVerifiedSeedPlan(food);
  assert.equal(result.seedPlanStatus,'blocked_by_source_review');
  assert.equal(result.seedCounts,null);
  assert.equal(result.writerAuthorized,false);
});

test('routine verified USDA foods automatically route to existing qualification, no founder review',()=>{
 const r=previewSourceFoods(sample());
 assert.equal(r.automaticQualificationCount,8);
 assert.equal(r.exceptionReviewCount,0);
 assert.equal(r.individualFounderApprovalRequired,false);
 assert.equal(r.qualificationQueue.length,8);
 assert(r.qualificationQueue.every(x=>x.route==='automatic_qualification'&&
   x.requiresFounderApproval===false&&x.writerAuthorized===false&&
   x.calculationReady===false&&x.publicationApproved===false));
});
test('failed source routes to exception queue while preserving qualified source entries',()=>{
 const foods=sample();
 foods[1].payload_sha256='0'.repeat(64);
 const r=previewSourceFoods(foods);
 assert.equal(r.status,'review_required');
 assert.equal(r.automaticQualificationCount,7);
 assert.equal(r.exceptionReviewCount,1);
 const failed=r.qualificationQueue.find(x=>x.source_profile_key==='red_onion_raw');
 assert.equal(failed.route,'exception_review');
 assert(failed.reasons.includes('source_digest_reference_mismatch:red_onion_raw'));
 assert.equal(failed.requiresFounderApproval,false);
 assert.equal(failed.writerAuthorized,false);
});
test('batch-wide source contract failure blocks automatic qualification for all',()=>{
 const result=previewSourceFoods(sample().map(f=>({...f,archive_sha256:'f'.repeat(64)})));
 assert.equal(result.automaticQualificationCount,0);
 assert.equal(result.exceptionReviewCount,8);
 assert(result.qualificationQueue.every(r=>r.route==='exception_review'));
});
