import test from 'node:test';
import assert from 'node:assert/strict';
import {updateRacePaceLive,type RacePaceLiveState} from './racePaceLiveState.ts';
import type {RacePacePackage,RacePaceObservation} from './racePaceIndicator.ts';
const packageData=():RacePacePackage=>({
 workoutId:'race-one',routeId:'course-one',courseVersion:'final-v3',enabled:true,
 sections:[
  {id:'flat',startMeters:0,endMeters:1000,targetSecondsPerKm:360,terrain:'flat',gradePercent:0},
  {id:'climb',startMeters:1000,endMeters:2000,targetSecondsPerKm:480,terrain:'climb',gradePercent:8},
  {id:'downhill',startMeters:2000,endMeters:3000,targetSecondsPerKm:410,terrain:'descent',gradePercent:-9},
 ],
});
const sample=(update:Partial<RacePaceObservation>={}):RacePaceObservation=>({
 workoutId:'race-one',routeId:'course-one',courseVersion:'final-v3',
 elapsedSeconds:300,distanceOnCourseMeters:800,recentElapsedSeconds:30,
 recentDistanceMeters:80,routePositionTrusted:true,recordingPaused:false,...update,
});
function first():RacePaceLiveState{
 const result=updateRacePaceLive(packageData(),sample(),null);
 assert.equal(result.acceptance,'accepted');
 assert.equal(result.indicator.status,'ready');
 assert.equal(result.state?.smoothSecondsPerKm,null);
 return result.state!;
}
test('first position shows verified section and ahead/behind, but no invented live pace',()=>{
 const r=updateRacePaceLive(packageData(),sample(),null);
 assert.equal(r.indicator.status,'ready');
 if(r.indicator.status==='ready'){
  assert.equal(r.indicator.currentSecondsPerKm,null);
  assert.equal(r.indicator.sectionId,'flat');
  assert.equal(r.indicator.aheadSeconds,-12); // 800 m at 360s/km budget = 288 s.
 }
});
test('observed progress sets smoothed moving pace and crosses climb boundary',()=>{
 const a=first();
 const b=updateRacePaceLive(packageData(),sample({elapsedSeconds:360,distanceOnCourseMeters:1000}),a);
 assert.equal(b.acceptance,'accepted');
 assert.equal(b.indicator.status,'ready');
 if(b.indicator.status==='ready'){
  assert.equal(b.indicator.sectionId,'climb');
  assert.equal(b.indicator.currentSecondsPerKm,300);
  assert.equal(b.indicator.targetSecondsPerKm,480);
  assert.equal(b.indicator.noAutomaticPlanWrite,true);
 }
 const c=updateRacePaceLive(packageData(),sample({
  elapsedSeconds:420,distanceOnCourseMeters:1150,
 }),b.state);
 assert.equal(c.indicator.status,'ready');
 if(c.indicator.status==='ready'){
  assert.equal(Math.round(c.indicator.currentSecondsPerKm!),335); // 0.65*300+0.35*400
  assert.equal(c.indicator.targetSecondsPerKm,480);
  assert.equal(c.indicator.aheadSeconds,12); // 360 + 150m*480/km - 420
 }
});
test('GPS teleports and out-of-order samples do not update state or fake pacing',()=>{
 const a=first();
 for(const update of [
  {elapsedSeconds:301,distanceOnCourseMeters:1300},
  {elapsedSeconds:299,distanceOnCourseMeters:900},
  {elapsedSeconds:360,distanceOnCourseMeters:700},
 ]){
  const r=updateRacePaceLive(packageData(),sample(update),a);
  assert.equal(r.acceptance,'held');
  assert.equal(r.indicator.status,'unavailable');
  assert.deepEqual(r.state,a);
 }
 const recovered=updateRacePaceLive(packageData(),sample({
  elapsedSeconds:360,distanceOnCourseMeters:990,
 }),a);
 assert.equal(recovered.acceptance,'accepted');
 assert.equal(recovered.indicator.status,'ready');
});
test('paused, stationary, insufficient and stale samples do not display a moving pace',()=>{
 let state=first();
 const forward=updateRacePaceLive(packageData(),sample({elapsedSeconds:360,distanceOnCourseMeters:900}),state);
 assert.equal(forward.indicator.status,'ready');
 state=forward.state!;
 for(const changes of [
  {elapsedSeconds:420,distanceOnCourseMeters:900,recordingPaused:true},
  {elapsedSeconds:480,distanceOnCourseMeters:900},
  {elapsedSeconds:481,distanceOnCourseMeters:900},
  {elapsedSeconds:700,distanceOnCourseMeters:900},
 ]){
  const r=updateRacePaceLive(packageData(),sample(changes),state);
  assert.equal(r.acceptance,'accepted');
  assert.equal(r.indicator.status,'ready');
  if(r.indicator.status==='ready'){
   assert.equal(r.indicator.currentSecondsPerKm,null);
   assert.equal(r.indicator.paceRelation,'unknown');
  }
  state=r.state!;
 }
});
test('stale/untrusted GPS and mismatched course version fail closed',()=>{
 const a=first();
 for(const changes of [
  {routePositionTrusted:false},{courseVersion:'draft'},
  {routeId:'another-route'},{workoutId:'other-athlete'},
 ]){
  const r=updateRacePaceLive(packageData(),sample({...changes,elapsedSeconds:360}),a);
  assert.equal(r.indicator.status,'unavailable');
 }
 assert.equal(updateRacePaceLive({...packageData(),enabled:false},sample(),a).indicator.status,'disabled');
 const old:RacePaceLiveState={...a,courseVersion:'prior'};
 const replaced=updateRacePaceLive(packageData(),sample(),old);
 assert.equal(replaced.acceptance,'reset_required');
 assert.equal(replaced.state,null);
});
test('no approved grade target or corrupt route cannot be rescued by speed smoothing',()=>{
 const p=packageData();
 const r=updateRacePaceLive({...p,sections:[{...p.sections[0],gradePercent:200}]},
  sample(),null);
 assert.equal(r.acceptance,'held');
 assert.equal(r.indicator.status,'unavailable');
});
