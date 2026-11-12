import test from 'node:test';
import assert from 'node:assert/strict';
import {foodDayForToday,type CanonicalFuelFoodDay} from './fuelOwnerFoodRead.ts';
import {todayFoodLog} from '../today/todayFoodLog.ts';

const a='a1111111-1111-4111-8111-111111111111';
const b='b2222222-2222-4222-8222-222222222222';
const day='2026-11-12';
const entry={id:'11111111-1111-4111-8111-111111111111',user_id:a,
 consumed_at:'2026-11-12T18:00:00Z',local_date:day,
 meal_slot:'lunch',label:'Actual logged meal',
 created_at:'2026-11-12T18:00:00Z',deleted_at:null,revision:1};
const complete:CanonicalFuelFoodDay={
 ownerId:a,localDate:day,sourceRevision:'page-complete-1',complete:true,entries:[entry]};
const go=(v:CanonicalFuelFoodDay|null=complete,owner=a,date=day)=>
 foodDayForToday(v,owner,date);

test('only a complete canonical owner day can populate Today',()=>{
 const accepted=go();
 assert.equal(accepted.status,'ready');
 if(accepted.status!=='ready')return;
 assert.equal(accepted.entries[0]?.photo,null);
 const view=todayFoodLog(accepted,a,day);
 assert.equal(view.status,'ready');
 assert.equal(view.visible[0]?.label,'Actual logged meal');
 assert.equal(view.visible[0]?.photoUri,null);
});
test('missing or partial page coverage never claims an empty day',()=>{
 assert.equal(go(null).status,'unavailable');
 assert.equal(go({...complete,complete:false}).status,'unavailable');
 assert.equal(go({...complete,sourceRevision:''}).status,'unavailable');
 assert.equal(go({...complete,complete:false,entries:[]}).status,'unavailable');
 assert.equal(go({...complete,entries:[]}).status,'ready');
});
test('foreign owner, foreign row and a different selected day fail closed',()=>{
 assert.equal(go(complete,b).status,'unavailable');
 assert.equal(go({...complete,entries:[{...entry,user_id:b}]}).status,'unavailable');
 assert.equal(go(complete,a,'2026-11-11').status,'unavailable');
 assert.equal(go({...complete,entries:[{...entry,local_date:'2026-11-11'}]}).status,'unavailable');
});
test('tombstones, duplicates, malformed values cannot pollute Today',()=>{
 assert.equal(go({...complete,entries:[{...entry,deleted_at:'2026-11-12T20:00:00Z'}]}).status,'unavailable');
 assert.equal(go({...complete,entries:[entry,entry]}).status,'unavailable');
 assert.equal(go({...complete,entries:[{...entry,revision:0}]}).status,'unavailable');
 assert.equal(go({...complete,entries:[{...entry,meal_slot:'invalid'}]}).status,'unavailable');
 assert.equal(go({...complete,entries:[{...entry,consumed_at:'garbage'}]}).status,'unavailable');
 assert.equal(go({...complete,entries:[{...entry,label:' '}]}).status,'unavailable');
});
test('invalid calendar dates are not treated as valid daily snapshots',()=>{
 assert.equal(go(complete,a,'2026-02-30').status,'unavailable');
 assert.equal(go({...complete,localDate:'2026-02-30'},a,'2026-02-30').status,'unavailable');
});
