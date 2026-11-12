import test from 'node:test';
import assert from 'node:assert/strict';
import {projectVerifiedKitchenWeek,reviewedPantryAvailability,
 type CanonicalPantrySnapshot,type ReviewedPantryLot} from './kitchenVerifiedPantryBridge.ts';
import type {KitchenWeek} from './kitchenPlanOwnerClient.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const baseLot:ReviewedPantryLot={
 id:'pantry-1',ownerId:owner,foodId:'banana',kind:'edible',
 preparationState:'as_sold',unit:'each',onHand:5,reserved:2,usable:true,
 expiry:{status:'known',localDate:'2026-11-24'},
};
const snapshot=(lots:ReviewedPantryLot[]=[baseLot]):CanonicalPantrySnapshot=>({
 ownerId:owner,complete:true,revision:'pantry-v4',asOfDate:'2026-11-12',lots,
});
const plan:KitchenWeek={
 ownerId:owner,weekStart:'2026-11-16',version:2,complete:true,
 entries:[{id:'meal-1',eatDate:'2026-11-17',mealSlot:'lunch',sourceKind:'food',
  sourceId:'banana',portions:6,executionMode:'planned_food'}],
};
const source={
 ownerId:owner,sourceKind:'food' as const,sourceId:'banana',complete:true as const,
 requirements:[{foodId:'banana',preparationState:'as_sold',unit:'each',perServing:1}],
};
const evaluate=(s:CanonicalPantrySnapshot=snapshot())=>
 projectVerifiedKitchenWeek({week:plan,pantrySnapshot:s,sources:[source],
  preparedCoverage:{},confirmedPreparedEntryIds:[]});

test('reserved stock cannot reduce Shopping demand, with no Pantry mutation',()=>{
 const original=snapshot();
 const before=JSON.stringify(original);
 const result=evaluate(original);
 assert.equal(result.shortages[0].foodId,'banana');
 assert.equal(result.shortages[0].required,6);
 assert.equal(result.shortages[0].available,3);
 assert.equal(result.shortages[0].shortage,3);
 assert.deepEqual(result.excludedLotIds,[]);
 assert.equal(JSON.stringify(original),before);
});
test('expired, uncertain or unusable stock is excluded, not claimed available',()=>{
 const items=[
  {...baseLot,expiry:{status:'known' as const,localDate:'2026-11-19'}},
  {...baseLot,expiry:{status:'unknown' as const}},
  {...baseLot,usable:false},
 ];
 for(const item of items){
  const projection=evaluate(snapshot([item]));
  assert.equal(projection.shortages[0].shortage,6);
  assert.deepEqual(projection.excludedLotIds,['pantry-1']);
 }
});
test('exact preparation state and unit prevent raw/cooked substitutions',()=>{
 const cooked={...baseLot,preparationState:'cooked'};
 const grams={...baseLot,unit:'g'};
 for(const item of [cooked,grams])
  assert.equal(evaluate(snapshot([item])).shortages[0].shortage,6);
});
test('compatible supplies remain available only through the same identity pipeline',()=>{
 const bag={...baseLot,id:'bag-1',kind:'supply' as const,foodId:'freezer-bag',
  preparationState:'as_sold',unit:'each',onHand:2,reserved:1,
  expiry:{status:'not_applicable' as const}};
 const result=reviewedPantryAvailability(snapshot([bag]),owner,'2026-11-22');
 assert.deepEqual(result.available,[{foodId:'freezer-bag',preparationState:'as_sold',
  unit:'each',onHand:2,reserved:1}]);
});
test('rejects missing/foreign/partial Pantry snapshots and foreign lots',()=>{
 const s=snapshot();
 assert.throws(()=>evaluate({...s,ownerId:foreign}),/owner Pantry/);
 assert.throws(()=>evaluate({...s,complete:false as true}),/owner Pantry/);
 assert.throws(()=>evaluate({...s,revision:''}),/owner Pantry/);
 assert.throws(()=>evaluate(snapshot([{...baseLot,ownerId:foreign}])),/foreign/);
 assert.throws(()=>evaluate(snapshot([baseLot,baseLot])),/foreign/);
 assert.throws(()=>evaluate(snapshot([{...baseLot,reserved:6}])),/foreign/);
 assert.throws(()=>evaluate(snapshot([{...baseLot,onHand:-2}])),/foreign/);
 assert.throws(()=>evaluate(snapshot([{...baseLot,expiry:{status:'known',localDate:'2026-02-30'}}])),/foreign/);
});
test('different plan and Pantry owner fails even with compatible food identities',()=>{
 assert.throws(()=>projectVerifiedKitchenWeek({
  week:{...plan,ownerId:foreign},pantrySnapshot:snapshot(),
  sources:[source],preparedCoverage:{},confirmedPreparedEntryIds:[],
 }),/owner Pantry/);
});
test('in-week snapshot accepted; future inventory cannot be used for a historical week',()=>{
 assert.equal(evaluate({...snapshot(),asOfDate:'2026-11-18'}).shortages[0].shortage,3);
 assert.throws(()=>evaluate({...snapshot(),asOfDate:'2026-11-23'}),/later than/);
});
test('uncertain ingredient identity still shows unresolved, never zero inferred purchase',()=>{
 const result=projectVerifiedKitchenWeek({week:plan,pantrySnapshot:snapshot(),
  sources:[],preparedCoverage:{},confirmedPreparedEntryIds:[]});
 assert.equal(result.unresolved[0].reason,'unknown_identity');
 assert.equal(result.shortages.length,0);
});
