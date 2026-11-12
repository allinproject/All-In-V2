'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,review,reviewSourceBindings,reviewAliasAndPreparationAcceptance}=require('./review-v2-ingredient-identities.cjs');
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

test('rejects missing locale or invalid alias candidates without identity guessing',()=>{
  const a=food('x');delete a.locale;a.aliases=['Chicken breast',''];
  const codes=review([a]).issues.map(v=>v.code);
  assert(codes.includes('locale_scope_unresolved'));
  assert(codes.includes('invalid_alias_set'));
});
test('rejects external ID without source data type',()=>{
  const a=food('x');a.sources=[{provider:'usda_fdc',external_record_id:'123'}];
  assert(review([a]).issues.some(v=>v.code==='invalid_source_reference'));
});

test('eight source review bindings match pinned USDA evidence without approving identities or nutrition',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json'),'utf8'));
 const bindings=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
 const r=reviewSourceBindings(bindings,evidence);
 assert.equal(r.structuralEvidencePassed,true);
 assert.equal(r.bindingCount,8);
 assert.equal(r.reviewedSourceCount,8);
 assert.equal(r.identityApproved,false);
 assert.equal(r.calculationReady,false);
 assert.equal(r.publicationApproved,false);
 assert.equal(r.authorizedToWrite,false);
});
test('tampered energy code, source URL, approval or yield fails closed',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json'),'utf8'));
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
 const clone=()=>JSON.parse(JSON.stringify(original));
 const energy=clone();energy.bindings[0].nutrition_evidence.energy_source_nutrient_id=2048;
 assert(reviewSourceBindings(energy,evidence).issues.some(x=>x.code==='nutrient_basis_or_energy_provenance_mismatch'));
 const url=clone();url.bindings[0].reviewed_source_reference.source_url='https://fake.example/food-details/328841/nutrients';
 assert(reviewSourceBindings(url,evidence).issues.some(x=>x.code==='source_reference_mismatch'));
 const approval=clone();approval.bindings[0].profile_approval='calculation_ready';
 assert(reviewSourceBindings(approval,evidence).issues.some(x=>x.code==='unreviewed_identity_or_alias_scope'));
 const yieldRecord=clone();yieldRecord.bindings[0].conversion_review.household_and_purchase_yields_approved=true;
 assert(reviewSourceBindings(yieldRecord,evidence).issues.some(x=>x.code==='measurement_evidence_or_yield_override'));
});
test('missing source, duplicate binding, and wrong archive fail closed',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json'),'utf8'));
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/evidence/ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
 const duplicate=JSON.parse(JSON.stringify(original));duplicate.bindings[1].source_profile_key=duplicate.bindings[0].source_profile_key;
 assert(reviewSourceBindings(duplicate,evidence).issues.some(x=>x.code==='duplicate_or_missing_source_profile_key'));
 const wrong=JSON.parse(JSON.stringify(original));wrong.sourceEvidenceArchiveSha256='0'.repeat(64);
 assert(reviewSourceBindings(wrong,evidence).issues.some(x=>x.code==='archive_hash_mismatch'));
 const missing=JSON.parse(JSON.stringify(original));missing.bindings.pop();
 assert(reviewSourceBindings(missing,evidence).issues.some(x=>x.code==='reviewed_source_coverage_mismatch'));
});

test('eight reviewed alias scopes are disjoint, form-specific and remain unapproved',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.join(__dirname,'../docs/evidence/');
 const aliases=JSON.parse(fs.readFileSync(path.join(root,'ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json'),'utf8'));
 const sources=JSON.parse(fs.readFileSync(path.join(root,'ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
 const r=reviewAliasAndPreparationAcceptance(aliases,sources);
 assert.equal(r.structuralScopePassed,true);
 assert.equal(r.recordCount,8);
 assert.equal(r.canonicalIdentityApproved,false);
 assert.equal(r.calculationReady,false);
 assert.equal(r.publicationApproved,false);
 assert.equal(r.requiresDomainOwnerAcceptance,true);
});
test('cannot promote ambiguous canned bean aliases or yield across states',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.join(__dirname,'../docs/evidence/');
 const original=JSON.parse(fs.readFileSync(path.join(root,'ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json'),'utf8'));
 const sources=JSON.parse(fs.readFileSync(path.join(root,'ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
 const clone=()=>JSON.parse(JSON.stringify(original));
 const badAlias=clone(),beans=badAlias.records.find(x=>x.source_profile_key==='beans_kidney_canned_drained');
 beans.exact_alias_candidates.push({value:'kidney beans',kind:'source_scoped_exact',preparation_state:'cooked_drained',
 selection_scope:'requires_explicit_source_form_confirmation',status:'founder_approved_source_scoped_alias_policy'});
 assert(reviewAliasAndPreparationAcceptance(badAlias,sources).issues.some(x=>x.code==='search_only_alias_promoted_to_exact'));
 const badState=clone();badState.records[0].preparation_state='raw';
 assert(reviewAliasAndPreparationAcceptance(badState,sources).issues.some(x=>x.code==='source_identity_or_preparation_scope_mismatch'));
 const badApprove=clone();badApprove.records[0].canonical_identity_approved=true;
 assert(reviewAliasAndPreparationAcceptance(badApprove,sources).issues.some(x=>x.code==='source_identity_or_preparation_scope_mismatch'));
});
test('cross-source exact alias collisions, missing records and premature document approval fail closed',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.join(__dirname,'../docs/evidence/');
 const original=JSON.parse(fs.readFileSync(path.join(root,'ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json'),'utf8'));
 const sources=JSON.parse(fs.readFileSync(path.join(root,'ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json'),'utf8'));
 const clone=()=>JSON.parse(JSON.stringify(original));
 const collisions=clone(),a=collisions.records[0].exact_alias_candidates[0];
 collisions.records[1].exact_alias_candidates.push({...a,preparation_state:collisions.records[1].preparation_state});
 assert(!reviewAliasAndPreparationAcceptance(collisions,sources).issues.some(x=>x.code==='cross_source_exact_alias_collision')); // separate state scopes; still fails approved alias allowlist
 collisions.records[2].exact_alias_candidates.push({...collisions.records[1].exact_alias_candidates[0]});
 assert(reviewAliasAndPreparationAcceptance(collisions,sources).issues.some(x=>x.code==='cross_source_exact_alias_collision'));
 const missing=clone();missing.records.pop();
 assert(reviewAliasAndPreparationAcceptance(missing,sources).issues.some(x=>x.code==='incomplete_source_alias_coverage'));
 const approval=clone();approval.canonicalIdentityApproved=true;
 assert(reviewAliasAndPreparationAcceptance(approval,sources).issues.some(x=>x.code==='alias_document_claims_unapproved_authority'));
});
