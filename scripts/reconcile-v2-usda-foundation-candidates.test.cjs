'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,tokens,prep,compare,reconcile}=require('./reconcile-v2-usda-foundation-candidates.cjs');
const food=(fdcId,description)=>({fdcId,description,category:'Foundation'});
const profile=(profile_key,label,aliases=[])=>({profile_key,label,aliases});
test('exact source description matches only create review candidate',()=>{
  const result=reconcile([food(1,'Blueberries, raw')],[profile('blueberry_raw','Blueberries, raw')]);
  assert.equal(result.statusCounts.exact_name_review_only,1);
  assert.equal(result.records[0].nutritionApproved,false);
  assert.equal(result.records[0].canonicalV2Id,null);
  assert.equal(result.approvalGranted,false);
});
test('preparation mismatch is reported rather than approved',()=>{
  const result=reconcile([food(1,'Chicken breast, raw')],[profile('chicken_cooked','Chicken breast, cooked')]);
  assert.equal(result.records[0].status,'lexical_candidates_review_only');
  assert.equal(result.records[0].suggestions[0].usdaPreparationHint,'raw_hint');
  assert.equal(result.records[0].suggestions[0].v1PreparationHint,'cooked_hint');
  assert.equal(result.records[0].nutritionApproved,false);
});
test('conflicting exact names block automatic identification',()=>{
  const r=reconcile([food(1,'Salt, fine')],[profile('salt1','Salt, fine'),profile('salt2','Other',['Salt, fine'])]);
  assert.equal(r.statusCounts.conflicting_exact_names,1);
  assert.equal(r.records[0].exactProfileKeys.length,2);
});
test('no lexical candidates remain unmatched without invented food identity',()=>{
  const r=reconcile([food(1,'Kale, raw')],[profile('unrelated','Chicken, cooked')]);
  assert.equal(r.statusCounts.no_lexical_candidate,1);
  assert.equal(r.sourceProfilesWithoutCandidate,1);
});
test('reconciliation sorts by FDC ID and caps suggestions deterministically',()=>{
  const profiles=Array.from({length:10},(_,i)=>profile('rice'+i,'Brown rice '+i));
  const r=reconcile([food(2,'Brown rice'),food(1,'Brown rice')],profiles);
  assert.equal(r.records[0].fdcId,1);
  assert(r.records[0].suggestions.length<=5);
  assert.equal(r.sourceFoodCount,2);
});
test('malformed and duplicate source inventories reject',()=>{
  assert.throws(()=>reconcile([food(1,'Beans'),food(1,'Rice')],[]));
  assert.throws(()=>reconcile([], [profile('x','Rice'),profile('x','Beans')]));
});
test('case, punctuation and whitespace are normalized without changing source identity',()=>{
  assert.equal(normalize(' Rice,   cooked! '),'rice cooked');
  assert.deepEqual(tokens('Blueberries, raw'),['blueberry']);
  assert(compare('Corn, yellow, raw','Corn yellow raw')===1);
});
