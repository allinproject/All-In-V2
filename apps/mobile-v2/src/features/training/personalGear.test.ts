import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPersonalGear,addPersonalGear,changeGearStatus,changeGearDistance,selectGearDefault,
  personalGearPatch,parsePersonalGear} from './personalGear.ts';

test('separate road and trail defaults use only compatible active shoes',()=>{
 const a=addPersonalGear(emptyPersonalGear(),{id:'a',name:'Road shoe',kind:'shoes',use:'road',status:'active',distanceKm:100,reminderKm:800});
 const b=addPersonalGear(a,{id:'b',name:'Trail shoe',kind:'shoes',use:'trail',status:'active',distanceKm:42,reminderKm:null});
 const chosen=selectGearDefault(selectGearDefault(b,'road','a'),'trail','b');
 assert.deepEqual(chosen.defaults,{road:'a',trail:'b',outdoorBike:null,indoorBike:null});
 assert.throws(()=>selectGearDefault(chosen,'trail','a'),/not active or suitable/);
 const retired=changeGearStatus(chosen,'a','retired');
 assert.equal(retired.defaults.road,null);
 assert.equal(retired.items[0].distanceKm,100);
 assert.equal(retired.items[0].status,'retired');
 assert.throws(()=>selectGearDefault(retired,'road','a'),/not active/);
});
test('indoor and outdoor bikes maintain independent defaults',()=>{
 const a=addPersonalGear(emptyPersonalGear(),{id:'a',name:'Road bike',kind:'bikes',use:'outdoor',status:'active',distanceKm:1000,reminderKm:null});
 const b=addPersonalGear(a,{id:'b',name:'Trainer bike',kind:'bikes',use:'indoor',status:'active',distanceKm:0,reminderKm:null});
 assert.equal(selectGearDefault(a,'outdoorBike','a').defaults.outdoorBike,'a');
 assert.throws(()=>selectGearDefault(b,'indoorBike','a'),/not active or suitable/);
 assert.equal(selectGearDefault(b,'indoorBike','b').defaults.indoorBike,'b');
});
test('gear persists under existing canonical training preferences and preserves manually corrected mileage',()=>{
 const a=addPersonalGear(emptyPersonalGear(),{id:'a',name:'Hydration vest',kind:'other',use:'general',status:'active',distanceKm:0,reminderKm:null});
 const changed=changeGearDistance(a,'a',123.4);
 const patch=personalGearPatch(changed);
 assert.deepEqual(parsePersonalGear({training_preferences:patch}),changed);
 assert.equal('equipment_locations' in patch,false);
 assert.throws(()=>changeGearDistance(changed,'a',-1),/Invalid mileage/);
});
test('invalid gear and invalid defaults are rejected',()=>{
 const blank=emptyPersonalGear();
 assert.throws(()=>addPersonalGear(blank,{id:'z',name:' ',kind:'shoes',use:'road',status:'active',distanceKm:0,reminderKm:null}),/name/);
 assert.throws(()=>addPersonalGear(blank,{id:'z',name:'Shoes',kind:'shoes',use:'road',status:'active',distanceKm:-10,reminderKm:null}),/Mileage/);
 assert.throws(()=>selectGearDefault(blank,'road','missing'),/not active/);
 assert.deepEqual(parsePersonalGear({}),blank);
});
