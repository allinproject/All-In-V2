import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalKitchenWeek,readKitchenWeek,writeKitchenWeek,
 type KitchenPlanServices,type PlannedKitchenEntry} from './kitchenPlanOwnerClient.ts';

const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const action='33333333-3333-4333-8333-333333333333';
const date='2026-11-16';
const food:PlannedKitchenEntry={
 id:'44444444-4444-4444-8444-444444444444',eatDate:date,mealSlot:'lunch',
 sourceKind:'food',sourceId:'verified-banana',portions:1,executionMode:'planned_food',
};
const recipe:PlannedKitchenEntry={
 ...food,id:'55555555-5555-4555-8555-555555555555',sourceKind:'recipe',
 sourceId:'recipe-bowl',executionMode:'prep_ahead',
};
const sample=(entries:PlannedKitchenEntry[]=[food,recipe])=>({
 ownerId:owner,weekStart:date,version:3,complete:true,entries,
});
test('canonical owner read accepts multiple planned foods in a slot and one-serving recipe',()=>{
 assert.equal(canonicalKitchenWeek(sample(),owner,date)?.entries.length,2);
 assert.equal(canonicalKitchenWeek({...sample(),ownerId:other},owner,date),null);
 assert.equal(canonicalKitchenWeek({...sample(),complete:false},owner,date),null);
 assert.equal(canonicalKitchenWeek({...sample(),version:-1},owner,date),null);
 assert.equal(canonicalKitchenWeek({...sample(),entries:[food,food]},owner,date),null);
 assert.equal(canonicalKitchenWeek({...sample(),entries:[{...recipe,portions:6}]},owner,date),null);
 assert.equal(canonicalKitchenWeek({...sample(),entries:[{...food,eatDate:'2026-11-23'}]},owner,date),null);
 assert.equal(canonicalKitchenWeek(sample(),owner,'2026-11-17'),null);
});
test('unavailable/disabled read is not treated as an empty Meal Plan',async()=>{
 let reads=0;
 const services:KitchenPlanServices={
  authenticateOwner:async()=>{},
  rpc:async()=>{reads++;return {data:sample(),error:null}},
 };
 assert.deepEqual(await readKitchenWeek(services,owner,date,()=>true,false),{status:'unavailable'});
 assert.equal(reads,0);
 assert.deepEqual(await readKitchenWeek(services,owner,date,()=>false,true),{status:'unavailable'});
 assert.equal(reads,0);
 assert.equal((await readKitchenWeek(services,owner,date,()=>true,true)).status,'ready');
 assert.equal(reads,1);
});
test('account switch during read rejects the entire result',async()=>{
 let valid=true;
 const services:KitchenPlanServices={
  authenticateOwner:async()=>{valid=false;},
  rpc:async()=>({data:sample(),error:null}),
 };
 assert.deepEqual(await readKitchenWeek(services,owner,date,()=>valid,true),{status:'unavailable'});
});
test('owner, incomplete fields and unsupported week input block writes before RPC',async()=>{
 let writes=0;
 const services:KitchenPlanServices={
  authenticateOwner:async()=>{},
  rpc:async()=>{writes++;return {data:4,error:null}},
 };
 assert.equal((await writeKitchenWeek(services,owner,date,3,action,[food],()=>true,false)).status,'disabled');
 assert.equal((await writeKitchenWeek(services,owner,'2026-11-17',3,action,[food],()=>true,true)).status,'invalid');
 assert.equal((await writeKitchenWeek(services,owner,date,3,action,[{...food,sourceId:''}],()=>true,true)).status,'invalid');
 assert.equal((await writeKitchenWeek(services,owner,date,3,action,[{...recipe,portions:6}],()=>true,true)).status,'invalid');
 assert.equal((await writeKitchenWeek(services,owner,date,3,action,[food,food],()=>true,true)).status,'invalid');
 assert.equal(writes,0);
});
test('writer sends one canonical action and returns only confirmed version',async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const services:KitchenPlanServices={
  authenticateOwner:async()=>{},
  rpc:async(name,args)=>{calls.push({name,args});return {data:4,error:null}},
 };
 assert.deepEqual(await writeKitchenWeek(services,owner,date,3,action,[food,recipe],()=>true,true),
  {status:'saved',version:4});
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0],{name:'v2_kitchen_replace_plan_week',args:{
  p_expected_user_id:owner,p_week_start:date,p_expected_version:3,
  p_action_id:action,p_entries:[food,recipe],
 }});
});
test('conflict, unauthorized, malformed and ambiguous outcomes fail closed',async()=>{
 const make=(data:unknown,error:KitchenPlanServices extends never?never:any,status?:number):KitchenPlanServices=>({
  authenticateOwner:async()=>{},rpc:async()=>({data,error,status}),
 });
 assert.equal((await writeKitchenWeek(make(null,{code:'40001'}),owner,date,3,action,[food],()=>true,true)).status,'conflict');
 assert.equal((await writeKitchenWeek(make(null,{code:'42501'}),owner,date,3,action,[food],()=>true,true)).status,'unauthorized');
 assert.equal((await writeKitchenWeek(make(null,null,409),owner,date,3,action,[food],()=>true,true)).status,'conflict');
 assert.equal((await writeKitchenWeek(make(null,null),owner,date,3,action,[food],()=>true,true)).status,'unavailable');
 assert.equal((await writeKitchenWeek(make('4',null),owner,date,3,action,[food],()=>true,true)).status,'unavailable');
});
