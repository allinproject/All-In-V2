import assert from 'node:assert/strict';
import test from 'node:test';
import {projectFoodPlanShopping,type PlannedKitchenOccurrence} from './foodPlanShoppingProjection.ts';
const food=(id:string,date:string,sourceId:string):PlannedKitchenOccurrence=>({
 id,localDate:date,mealSlot:'lunch',kind:'food',sourceId,servings:1,
 requirements:[{foodId:sourceId,preparationState:'as_sold',unit:'each',perServing:1}],
});
test('five lunches generate only missing bananas, apples and protein bars',()=>{
 const days=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20'];
 const occurrences=days.flatMap((day,index)=>['banana','apple','bar'].map(id=>food(id+index,day,id)));
 const pantry=[{foodId:'banana',preparationState:'as_sold',unit:'each',onHand:2,reserved:0},
 {foodId:'bar',preparationState:'as_sold',unit:'each',onHand:4,reserved:1}];
 const result=projectFoodPlanShopping({occurrences,pantry});
 assert.deepEqual(Object.fromEntries(result.shortages.map(x=>[x.foodId,x.shortage])),
  {apple:5,banana:3,bar:2});
 assert.equal(result.unresolved.length,0);
 assert.equal(result.demands.find(x=>x.foodId==='apple')?.occurrenceIds.length,5);
});
test('recipe and individual foods aggregate only matching identity, unit and preparation state',()=>{
 const occurrences:PlannedKitchenOccurrence[]=[food('banana','2026-11-16','banana'),{
 id:'bowl',localDate:'2026-11-17',mealSlot:'lunch',kind:'recipe',sourceId:'bowl',
 servings:3,requirements:[{foodId:'banana',preparationState:'as_sold',unit:'each',perServing:1},
 {foodId:'rice',preparationState:'cooked',unit:'g',perServing:80}]},{
 id:'rice-dry',localDate:'2026-11-18',mealSlot:'dinner',kind:'recipe',sourceId:'dry',
 servings:1,requirements:[{foodId:'rice',preparationState:'dry',unit:'g',perServing:100}]}];
 const result=projectFoodPlanShopping({occurrences,pantry:[]});
 assert.equal(result.demands.length,3);
 assert.equal(result.demands.find(x=>x.foodId==='banana')?.required,4);
 assert.equal(result.demands.find(x=>x.foodId==='rice'&&x.preparationState==='cooked')?.required,240);
 assert.equal(result.demands.find(x=>x.foodId==='rice'&&x.preparationState==='dry')?.required,100);
});
test('prepared portions reduce recipe need and other reservations protect Pantry',()=>{
 const occurrences:PlannedKitchenOccurrence[]=[{id:'bowl',localDate:'2026-11-16',mealSlot:'lunch',
 kind:'recipe',sourceId:'bowl',servings:6,preparedCoveredServings:2,
 requirements:[{foodId:'chicken',preparationState:'raw',unit:'oz',perServing:8}]}];
 const pantry=[{foodId:'chicken',preparationState:'raw',unit:'oz',onHand:40,reserved:10}];
 const result=projectFoodPlanShopping({occurrences,pantry});
 assert.equal(result.demands[0].required,32);
 assert.equal(result.demands[0].available,30);
 assert.equal(result.shortages[0].shortage,2);
});
test('removed planned food reduces Shopping without touching manual purchases',()=>{
 const a=food('a','2026-11-16','apple'),b=food('b','2026-11-17','apple');
 assert.equal(projectFoodPlanShopping({occurrences:[a,b],pantry:[]}).shortages[0].shortage,2);
 assert.equal(projectFoodPlanShopping({occurrences:[a],pantry:[]}).shortages[0].shortage,1);
});
test('ambiguous quantities are review-only, not invented purchases',()=>{
 const occurrences:PlannedKitchenOccurrence[]=[{id:'bar',localDate:'2026-11-16',
 mealSlot:'lunch',kind:'food',sourceId:'unresolved',servings:1,
 requirements:[{foodId:null,reason:'unknown_identity'}]}];
 const result=projectFoodPlanShopping({occurrences,pantry:[]});
 assert.equal(result.shortages.length,0);
 assert.deepEqual(result.unresolved,[{occurrenceId:'bar',sourceId:'unresolved',
 foodId:null,reason:'unknown_identity'}]);
});
test('missing ingredient or food portion lines cannot silently become zero shopping demand',()=>{
 const incomplete=food('unresolved-bar','2026-11-16','unreviewed-bar');
 assert.throws(()=>projectFoodPlanShopping({occurrences:[{...incomplete,requirements:[]}],pantry:[]}),/incomplete/);
});
test('invalid plan, stock, coverage and quantities fail closed',()=>{
 const one=food('a','2026-11-16','banana');
 assert.throws(()=>projectFoodPlanShopping({occurrences:[one,one],pantry:[]}),/duplicate/);
 assert.throws(()=>projectFoodPlanShopping({occurrences:[one],pantry:[{foodId:'banana',
 preparationState:'as_sold',unit:'each',onHand:1,reserved:2}]}),/reservation/);
 assert.throws(()=>projectFoodPlanShopping({occurrences:[{...one,localDate:'2026-02-30'}],pantry:[]}),/Malformed/);
 assert.throws(()=>projectFoodPlanShopping({occurrences:[{...one,preparedCoveredServings:1}],pantry:[]}),/coverage/);
 assert.throws(()=>projectFoodPlanShopping({occurrences:[{...one,requirements:[{
 foodId:'banana',preparationState:'as_sold',unit:'each',perServing:0}]}],pantry:[]}),/Reviewed/);
});
