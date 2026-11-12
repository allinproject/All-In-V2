import test from 'node:test';
import assert from 'node:assert/strict';
import {projectOwnedKitchenWeek} from './kitchenPlanDemandBridge.ts';
import type {KitchenWeek,PlannedKitchenEntry} from './kitchenPlanOwnerClient.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dates=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21'];
const food=(id:string,date:string,sourceId:string):PlannedKitchenEntry=>({
 id,eatDate:date,mealSlot:'lunch',sourceKind:'food',sourceId,portions:1,executionMode:'planned_food',
});
const recipe=(id:string,date:string):PlannedKitchenEntry=>({
 id,eatDate:date,mealSlot:'dinner',sourceKind:'recipe',sourceId:'philly',
 portions:1,executionMode:'prep_ahead',
});
const plan=(entries:PlannedKitchenEntry[]):KitchenWeek=>({
 ownerId:owner,weekStart:dates[0],version:1,complete:true,entries,
});
const source=(sourceKind:'food'|'recipe',sourceId:string,foodId:string,perServing:number,unit='each')=>({
 ownerId:owner,sourceKind,sourceId,complete:true as const,
 requirements:[{foodId,preparationState:'as_sold',unit,perServing}],
});
const input=(week:KitchenWeek,sources:ReturnType<typeof source>[])=>({
 week,sources,pantry:[],preparedCoverage:{},confirmedPreparedEntryIds:[],
});
test('five planned banana/apple/bar lunches and six recipe dinners aggregate shortages',()=>{
 const entries=dates.flatMap((day,i)=>[
  food('banana-'+i,day,'banana'),food('apple-'+i,day,'apple'),
  food('bar-'+i,day,'bar'),recipe('philly-'+i,day),
 ]);
 const sources=[source('food','banana','banana',1),source('food','apple','apple',1),
  source('food','bar','bar-product',1),source('recipe','philly','chicken',8,'oz')];
 const x=input(plan(entries),sources);
 const result=projectOwnedKitchenWeek({...x,
  pantry:[{foodId:'banana',preparationState:'as_sold',unit:'each',onHand:2,reserved:0},
   {foodId:'apple',preparationState:'as_sold',unit:'each',onHand:3,reserved:1},
   {foodId:'chicken',preparationState:'as_sold',unit:'oz',onHand:16,reserved:0}],
  preparedCoverage:{'philly-0':1},
 });
 assert.deepEqual(Object.fromEntries(result.shortages.map(z=>[z.foodId,z.shortage])),
  {'apple':4,'banana':4,'bar-product':6,'chicken':24});
 assert.equal(result.pendingPrepared.length,0);
});
test('missing reviewed product never silently disappears from shopping demand',()=>{
 const x=input(plan([food('bar','2026-11-16','unknown-bar')]),[]);
 const result=projectOwnedKitchenWeek(x);
 assert.equal(result.shortages.length,0);
 assert.equal(result.unresolved[0].reason,'unknown_identity');
 assert.equal(result.unresolved[0].sourceId,'unknown-bar');
});
test('already prepared food requires confirmed stock rather than a fresh shopping fiction',()=>{
 const prepared:PlannedKitchenEntry={id:'prepared',eatDate:dates[0],mealSlot:'lunch',
  sourceKind:'prepared_meal',sourceId:'batch',portions:1,executionMode:'already_prepared'};
 const x=input(plan([prepared]),[]);
 assert.deepEqual(projectOwnedKitchenWeek(x).pendingPrepared,['prepared']);
 assert.deepEqual(projectOwnedKitchenWeek({...x,confirmedPreparedEntryIds:['prepared']}).pendingPrepared,[]);
});
test('wrong-owner source or untrusted ingredient evidence fails closed',()=>{
 const entry=food('banana',dates[0],'banana');
 const x=input(plan([entry]),[source('food','banana','banana',1)]);
 assert.throws(()=>projectOwnedKitchenWeek({...x,sources:[{...x.sources[0],ownerId:'other'}]}),/Unverified/);
 assert.throws(()=>projectOwnedKitchenWeek({...x,sources:[x.sources[0],x.sources[0]]}),/Duplicate/);
 assert.throws(()=>projectOwnedKitchenWeek({...x,preparedCoverage:{absent:1}}),/Foreign/);
 assert.throws(()=>projectOwnedKitchenWeek({...x,confirmedPreparedEntryIds:['absent']}),/Foreign/);
});
test('fractional fruit portion does not inflate Shopping demand',()=>{
 const half={...food('half',dates[0],'apple'),portions:0.5};
 const x=input(plan([half]),[source('food','apple','apple',1)]);
 assert.equal(projectOwnedKitchenWeek(x).shortages[0].shortage,0.5);
});
