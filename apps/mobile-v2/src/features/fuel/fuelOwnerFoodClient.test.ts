import test from 'node:test';
import assert from 'node:assert/strict';
import {readCanonicalFuelDay, type FoodDayReadServices} from './fuelOwnerFoodClient.ts';
import {todayFoodLog} from '../today/todayFoodLog.ts';

const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', day='2026-11-12';
const payload={
 ownerId:owner,localDate:day,sourceRevision:'fuel-food-day-v1:abcdef',complete:true,
 entries:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user_id:owner,consumed_at:'2026-11-12T18:00:00Z',
 local_date:day,meal_slot:'lunch',label:'Food',created_at:'2026-11-12T18:00:00Z',
 deleted_at:null,revision:1}],
};
function services(data:unknown=payload,overrides:Partial<FoodDayReadServices>={}):FoodDayReadServices{
 return {authenticateOwner:async()=>{},readCompleteDay:async()=>({data,error:null}),...overrides};
}
const enabled=(s:FoodDayReadServices,ownerId=owner,date=day,isCurrent=()=>true)=>
 readCanonicalFuelDay(s,ownerId,date,isCurrent,true);

test('disabled by default: no RPC or session calls',async()=>{
 let called=false;
 const s=services(payload,{authenticateOwner:async()=>{called=true;},
  readCompleteDay:async()=>{called=true;return {data:payload,error:null};}});
 const r=await readCanonicalFuelDay(s,owner,day);
 assert.equal(r.status,'unavailable');
 assert.equal(called,false);
});

test('authorized complete day maps into existing Today food log',async()=>{
 let auth=0,rpc=0;
 const s=services(payload,{authenticateOwner:async()=>{auth++;},
  readCompleteDay:async(name,args)=>{
   rpc++;assert.equal(name,'v2_food_log_read_complete_day');
   assert.deepEqual(args,{p_expected_user_id:owner,p_local_date:day});
   return {data:payload,error:null};
  }});
 const r=await enabled(s);
 assert.equal(auth,2);assert.equal(rpc,1);
 assert.equal(r.status,'ready');
 const glance=todayFoodLog(r,owner,day);
 assert.equal(glance.status,'ready');
 assert.equal(glance.visible[0]?.label,'Food');
 assert.equal(glance.visible[0]?.photoUri,null);
});

test('rejects API errors, missing RPC, incomplete page, and cross-account rows',async()=>{
 for (const response of [
  {data:null,error:{message:'RPC unavailable'}},
  {data:{...payload,complete:false},error:null},
  {data:{...payload,entries:[{...payload.entries[0],user_id:other}]},error:null},
  {data:{...payload,entries:[{...payload.entries[0],deleted_at:'2026-11-12T19:00:00Z'}]},error:null},
 ]) {
  const r=await enabled(services(null,{readCompleteDay:async()=>response}));
  assert.equal(r.status,'unavailable');
 }
});

test('session must match owner before and after remote read',async()=>{
 let invoked=0;
 const failBefore=services(payload,{authenticateOwner:async()=>{throw Error('wrong owner');},
  readCompleteDay:async()=>{invoked++;return {data:payload,error:null};}});
 assert.equal((await enabled(failBefore)).status,'unavailable');
 assert.equal(invoked,0);
 let calls=0;
 const failAfter=services(payload,{authenticateOwner:async()=>{
  calls++;if(calls===2)throw Error('session switched');
 }});
 assert.equal((await enabled(failAfter)).status,'unavailable');
 assert.equal(calls,2);
});

test('navigation or signout invalidates inflight read',async()=>{
 let current=true;
 const s=services(payload,{readCompleteDay:async()=>{current=false;return {data:payload,error:null};}});
 assert.equal((await enabled(s,owner,day,()=>current)).status,'unavailable');
 assert.equal((await enabled(services(),owner,day,()=>false)).status,'unavailable');
});

test('wrong date/owner in response is never accepted',async()=>{
 assert.equal((await enabled(services({...payload,ownerId:other}))).status,'unavailable');
 assert.equal((await enabled(services({...payload,localDate:'2026-11-13'}))).status,'unavailable');
});
