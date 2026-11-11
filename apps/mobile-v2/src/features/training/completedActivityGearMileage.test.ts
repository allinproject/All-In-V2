import test from 'node:test';
import assert from 'node:assert/strict';
import {addPersonalGear,emptyPersonalGear} from './personalGear.ts';
import {deriveGearMileage,type CanonicalGearAssignment} from './completedActivityGearMileage.ts';
const gear=()=>{
 let state=addPersonalGear(emptyPersonalGear(),{id:'road-shoe',name:'Road shoes',kind:'shoes',use:'road',status:'active',distanceKm:150,reminderKm:800});
 state=addPersonalGear(state,{id:'trail-shoe',name:'Trail shoes',kind:'shoes',use:'trail',status:'retired',distanceKm:80,reminderKm:800});
 return addPersonalGear(state,{id:'bike',name:'Bicycle',kind:'bikes',use:'outdoor',status:'active',distanceKm:1000,reminderKm:null});
};
const assign=(activityId:string,gearId:string|null,distanceKm:number|null,sport:CanonicalGearAssignment['sport']='running'):CanonicalGearAssignment=>({
 ownerId:'owner-A',activityId,activityVersion:1,gearId,distanceKm,sport,confirmed:gearId!==null,
});
test('manual starting mileage plus confirmed workout distance is calculated once',()=>{
 const a=assign('run-1','road-shoe',10),b=assign('run-2','road-shoe',5.5);
 const rows=deriveGearMileage('owner-A',gear(),[a,a,b],true);
 assert.equal(rows[0].manualBaselineKm,150);
 assert.equal(rows[0].completedDistanceKm,15.5);
 assert.equal(rows[0].totalDistanceKm,165.5);
 assert.equal(rows[0].activityCount,2);
});
test('editing shoe attribution reassigns activity distance instead of double-counting',()=>{
 const before=deriveGearMileage('owner-A',gear(),[assign('run-1','road-shoe',10)],true);
 const after=deriveGearMileage('owner-A',gear(),[assign('run-1','trail-shoe',10)],true);
 assert.equal(before[0].totalDistanceKm,160);
 assert.equal(after[0].totalDistanceKm,150);
 assert.equal(after[1].totalDistanceKm,90);
 assert.equal(after[1].status,'retired');
});
test('deleting an activity removes only its linked mileage, not baseline',()=>{
 const before=deriveGearMileage('owner-A',gear(),[assign('run-1','road-shoe',12)],true);
 const after=deriveGearMileage('owner-A',gear(),[],true);
 assert.equal(before[0].totalDistanceKm,162);
 assert.equal(after[0].totalDistanceKm,150);
});
test('unknown distance or no user confirmed gear contributes no mileage',()=>{
 const rows=deriveGearMileage('owner-A',gear(),[assign('run-1',null,null)],true);
 assert.equal(rows[0].completedDistanceKm,0);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[assign('run-2','road-shoe',null)],true),/incomplete/);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[{...assign('run-2','road-shoe',3),confirmed:false}],true),/Unconfirmed/);
});
test('rejects cross-account attribution, conflicting revisions, incomplete history',()=>{
 const a=assign('run-1','road-shoe',10);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[{...a,ownerId:'owner-B'}],true),/owner/);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[a,{...a,activityVersion:2}],true),/Conflicting/);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[a],false),/Complete/);
});
test('cannot credit a running shoe with cycling distance or an unknown gear ID',()=>{
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[assign('bike-ride','road-shoe',20,'cycling')],true),/incompatible/);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[assign('run-1','bike',8)],true),/incompatible/);
 assert.throws(()=>deriveGearMileage('owner-A',gear(),[assign('run-1','other-shoe',8)],true),/Unrecognized/);
 const valid=deriveGearMileage('owner-A',gear(),[assign('bike-ride','bike',25,'cycling')],true);
 assert.equal(valid[2].totalDistanceKm,1025);
});
