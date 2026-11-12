import test from 'node:test';
import assert from 'node:assert/strict';
import {
 writeManualFood,type FoodWriteServices,type ManualFoodCommand,
} from './fuelOwnerFoodWrite.ts';

const owner='11111111-1111-4111-8111-111111111111';
const entry='22222222-2222-4222-8222-222222222222';
const action='33333333-3333-4333-8333-333333333333';
const replacement={
 consumedAt:'2026-11-12T18:00:00Z',localDate:'2026-11-12',
 timezoneName:'America/Chicago',mealSlot:'lunch' as const,label:'Real meal',
 quantity:1,unit:'serving' as const,kcal:null,nutritionSource:'unknown' as const,
};
const command:ManualFoodCommand={
 operation:'add',ownerId:owner,entryId:entry,actionId:action,replacement,
};
function services(
 data:unknown={id:entry,revision:1,replayed:false},
 overrides:Partial<FoodWriteServices>={},
):FoodWriteServices{
 return {authenticateOwner:async()=>{},
  mutate:async()=>({data,error:null,status:200}),...overrides};
}
const run=(s:FoodWriteServices,c:ManualFoodCommand=command,active=()=>true)=>
 writeManualFood(s,c,active,true);

test('off by default, no authentication or network request',async()=>{
 let count=0;
 const s=services(undefined,{authenticateOwner:async()=>{count++;},
  mutate:async()=>{count++;return {data:null,error:null};}});
 assert.deepEqual(await writeManualFood(s,command),{status:'disabled'});
 assert.equal(count,0);
});
test('add uses canonical RPC and does not invent nutrition',async()=>{
 let auth=0;
 const s=services(undefined,{authenticateOwner:async()=>{auth++;},
  mutate:async(name,params)=>{
   assert.equal(name,'v2_food_log_add_manual');
   assert.equal(params.p_expected_user_id,owner);
   assert.equal(params.p_kcal,null);
   assert.equal(params.p_nutrition_source,'unknown');
   assert.equal(params.p_action_id,action);
   return {data:{id:entry,revision:1,replayed:false},error:null};
  }});
 assert.deepEqual(await run(s),{status:'saved',entryId:entry,revision:1,replayed:false});
 assert.equal(auth,2);
});
test('edit and move honor expected revision and supplied action ID',async()=>{
 for(const operation of ['edit','move'] as const){
  const c:ManualFoodCommand={operation,ownerId:owner,entryId:entry,actionId:action,
   expectedRevision:2,replacement:{...replacement,kcal:350,nutritionSource:'user_entered'}};
  const s=services(undefined,{mutate:async(name,params)=>{
   assert.equal(name,'v2_food_log_mutate_manual');
   assert.equal(params.p_operation,operation);
   assert.equal(params.p_expected_revision,2);
   assert.equal(params.p_action_id,action);
   assert.equal(params.p_kcal,350);
   return {data:{id:entry,revision:3,replayed:false},error:null};
  }});
  assert.equal((await run(s,c)).status,'saved');
 }
});
test('delete has no nutrition replacement; exact retry returns replayed',async()=>{
 const c:ManualFoodCommand={operation:'delete',ownerId:owner,entryId:entry,
  actionId:action,expectedRevision:3};
 const s=services(undefined,{mutate:async(name,params)=>{
  assert.equal(name,'v2_food_log_mutate_manual');
  assert.deepEqual(Object.keys(params).sort(),
   ['p_expected_user_id','p_action_id','p_entry_id','p_expected_revision','p_operation'].sort());
  return {data:{id:entry,revision:4,replayed:true},error:null};
 }});
 assert.deepEqual(await run(s,c),{status:'saved',entryId:entry,revision:4,replayed:true});
});
test('HTTP 409 is never automatically retried or masked as success',async()=>{
 let count=0;
 const s=services(undefined,{mutate:async()=>{count++;
  return {data:null,error:{code:'PT409'},status:409};
 }});
 assert.deepEqual(await run(s),{status:'conflict'});
 assert.equal(count,1);
});
test('invalid units, unknown calories or action identity fail before RPC',async()=>{
 let invoked=0;
 const s=services(undefined,{authenticateOwner:async()=>{invoked++;}});
 const invalids:ManualFoodCommand[]=[
  {...command,actionId:'not-a-uuid'},
  {...command,replacement:{...replacement,localDate:'2026-02-30'}},
  {...command,replacement:{...replacement,quantity:0}},
  {...command,replacement:{...replacement,kcal:300}},
  {...command,replacement:{...replacement,nutritionSource:'user_entered',kcal:null}},
  {...command,replacement:{...replacement,unit:'bad' as 'serving'}},
  {operation:'delete',ownerId:owner,entryId:entry,actionId:action,expectedRevision:0},
 ];
 for(const c of invalids)assert.equal((await run(s,c)).status,'invalid');
 assert.equal(invoked,0);
});
test('foreign or expired owner session is never confirmed',async()=>{
 let called=0;
 const s=services(undefined,{authenticateOwner:async()=>{called++;
  if(called===2)throw Error('Owner switched');
 }});
 assert.equal((await run(s)).status,'unauthorized');
 assert.equal(called,2);
});
test('navigation invalidates in-flight write confirmation',async()=>{
 let active=true;
 const s=services(undefined,{mutate:async()=>{active=false;
  return {data:{id:entry,revision:1,replayed:false},error:null};}});
 assert.equal((await run(s,command,()=>active)).status,'unavailable');
});
test('untrusted server response cannot confirm a mutation',async()=>{
 for(const data of [
  {id:'ffffffff-ffff-4fff-8fff-ffffffffffff',revision:1,replayed:false},
  {id:entry,revision:0,replayed:false},
  {id:entry,revision:1,replayed:'false'},
  null,
 ]){
  assert.equal((await run(services(data))).status,'unavailable');
 }
});
