'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,review}=require('./review-v2-ingredient-identities.cjs');
function food(key,state='cooked') {return {source_profile_key:key,canonical_name:'Chicken breast',
  identity_kind:'generic_food',preparation_state:state,locale:'en',
  aliases:['Chicken breast, boneless']};}
test('normalizes whitespace and case without treating provider keys as identity',()=>{
  assert.equal(normalize('  CHICKEN   Breast '),'chicken breast');
  assert.equal(normalize(null),'');
});
test('separate raw and cooked profile candidates are not silently combined',()=>{
  const result=review([food('chicken_raw','raw'),food('chicken_cooked','cooked')]);
  assert.equal(result.structuralPreflightPassed,true);
  assert.equal(result.publicationApproved,false);
  assert.equal(result.calculationReady,false);
  assert.equal(result.validForAutomaticMerge,false);
});
test('duplicate source profile keys fail',()=>{
  const result=review([food('cooked'),food('cooked')]);
  assert(result.issues.some(x=>x.code==='duplicate_source_profile_key'));
});
test('alias collisions within the same scope are reported, not auto-merged',()=>{
  const a=food('a'),b=food('b');
  const result=review([a,b]);
  assert(result.ambiguities.some(x=>x.kind==='alias_scope_conflict'));
});
test('branded product without reviewed brand requires review',()=>{
  const a=food('product');a.identity_kind='branded_product';
  assert(review([a]).issues.some(x=>x.code==='branded_source_requires_brand_review'));
});
test('unknown preparation or identity kind cannot be treated as ready',()=>{
  const a=food('unknown');a.identity_kind='unclassified';a.preparation_state='unknown';
  const codes=review([a]).issues.map(x=>x.code);
  assert(codes.includes('identity_kind_unresolved'));assert(codes.includes('preparation_state_unresolved'));
});
test('duplicate exact external source identifiers across different profiles are conflicts',()=>{
  const a=food('a'),b=food('b');
  a.sources=[{provider:'usda_fdc',source_data_type:'Foundation',external_record_id:'123'}];
  b.sources=[{provider:'usda_fdc',source_data_type:'Foundation',external_record_id:'123'}];
  assert(review([a,b]).ambiguities.some(x=>x.kind==='source_reference_conflict'));
});
test('GTIN leading zeros are retained as text, invalid numeric GTIN is rejected',()=>{
  const a=food('gtin');a.identity_kind='branded_product';a.brand_owner='Brand';
  a.sources=[{provider:'open_food_facts',source_data_type:'branded',external_record_id:'123',gtin:'00012345678905'}];
  assert.equal(review([a]).structuralPreflightPassed,true);
  a.sources[0].gtin=12345678905;
  assert(review([a]).issues.some(x=>x.code==='invalid_gtin_preserve_exact_text'));
});
test('legacy profile cannot self-assert calculation_ready or assign canonical V2 ID',()=>{
  const a=food('candidate');a.review_status='calculation_ready';a.canonical_v2_id='some-id';
  const codes=review([a]).issues.map(x=>x.code);
  assert(codes.includes('candidate_must_not_self_attest_calculation_ready'));
  assert(codes.includes('v2_identity_assignment_requires_approved_writer'));
});
test('malformed candidates fail closed, empty input never proves publication',()=>{
  const result=review([null,{}]);
  assert(result.issues.some(x=>x.code==='invalid_candidate'));
  assert.equal(review([]).publicationApproved,false);
});
