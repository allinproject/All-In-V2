import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFoundationCandidateJson,APPROVED_RELEASE_SHA256} from './inspect-v2-usda-foundation-candidates.mjs';
const source=rows=>({FoundationFoods:rows});
const food=(id,description='Banana, raw')=>({
 fdcId:id,description,dataType:'Foundation',
 foodNutrients:[{id:1,amount:100,nutrient:{id:1008,unitName:'kcal'}}],
});
const preview=rows=>inspectFoundationCandidateJson(source(rows),{archiveSha256:APPROVED_RELEASE_SHA256});
test('unique USDA identities are candidates, never calculation-ready',()=>{
 const result=preview([food(123,'Banana'),food(456,'Apple')]);
 assert.deepEqual(result.preview_counts,{
  candidate_insert:2,unchanged:0,review_changed_source:0,conflict:0,
 });
 assert.equal(result.publication_allowed,false);
 assert.equal(result.report.records,2);
});
test('duplicate source IDs cannot silently create two ingredients',()=>{
 const result=preview([food(123,'Banana'),food(123,'Changed banana')]);
 assert.equal(result.preview_counts.conflict,1);
 assert.equal(result.preview_counts.candidate_insert,0);
 assert.equal(result.conflicts.length,1);
});
test('changed source retains existing mapping for review',()=>{
 const existing=[{
  provider:'usda_fdc',source_data_type:'Foundation',external_record_id:'123',
  payload_sha256:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ingredient_id:null,
 }];
 const changed=inspectFoundationCandidateJson(source([food(123)]),{
  archiveSha256:APPROVED_RELEASE_SHA256,existing,
 });
 assert.equal(changed.preview_counts.review_changed_source,1);
});
test('unsupported Branded records cannot become generic Foundation',()=>{
 const result=preview([{...food(123),dataType:'Branded'},food(456)]);
 assert.equal(result.report.unsupported_data_type,1);
 assert.equal(result.preview_counts.candidate_insert,1);
});
test('duplicate nutrient observations and unknown nutrients stay candidate-only',()=>{
 const result=preview([{
  ...food(123),foodNutrients:[{nutrient:{id:1008,unitName:'kcal'},amount:1},
   {nutrient:{id:1008,unitName:'kcal'},amount:2}],
 },{...food(456),foodNutrients:null}]);
 assert.equal(result.report.duplicate_nutrient_observations,1);
 assert.equal(result.report.missing_nutrients,1);
 assert.equal(result.publication_allowed,false);
});
test('unverified archive, malformed root and empty records fail closed',()=>{
 assert.throws(()=>inspectFoundationCandidateJson(source([food(123)]),{archiveSha256:'0'.repeat(64)}),/Unrecognized/);
 assert.throws(()=>preview([]),/Expected bounded/);
 assert.throws(()=>inspectFoundationCandidateJson({other:[]},{archiveSha256:APPROVED_RELEASE_SHA256}),/Expected bounded/);
});
