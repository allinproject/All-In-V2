import test from 'node:test';
import assert from 'node:assert/strict';
import {racePaceIndicator,type RacePacePackage,type RacePaceObservation} from './racePaceIndicator.ts';

const plan=():RacePacePackage=>({
 workoutId:'planned-race-1',routeId:'official-route',courseVersion:'2026-final',enabled:true,
 sections:[
  {id:'flat',startMeters:0,endMeters:1000,targetSecondsPerKm:360,terrain:'flat',gradePercent:0},
  {id:'hill',startMeters:1000,endMeters:2000,targetSecondsPerKm:480,terrain:'climb',gradePercent:8},
  {id:'descent',startMeters:2000,endMeters:3000,targetSecondsPerKm:400,terrain:'descent',gradePercent:-6},
 ],
});
const observation=(patch:Partial<RacePaceObservation>={}):RacePaceObservation=>({
 workoutId:'planned-race-1',routeId:'official-route',courseVersion:'2026-final',
 elapsedSeconds:350,distanceOnCourseMeters:1000,recentDistanceMeters:100,
 recentElapsedSeconds:36,routePositionTrusted:true,recordingPaused:false,...patch,
});
test('at course boundary switches from flats to approved climb pacing; current speed is independent',()=>{
 const before=racePaceIndicator(plan(),observation({distanceOnCourseMeters:999,elapsedSeconds:350}));
 assert.equal(before.status,'ready');
 if(before.status!=='ready')return;
 assert.equal(before.sectionId,'flat');
 assert.equal(before.targetSecondsPerKm,360);
 assert.equal(before.nextTerrain,'climb');
 assert.equal(before.metersToNextSection,1);
 const climb=racePaceIndicator(plan(),observation());
 assert.equal(climb.status,'ready');
 if(climb.status!=='ready')return;
 assert.equal(climb.sectionId,'hill');
 assert.equal(climb.targetSecondsPerKm,480);
 assert.equal(climb.currentSecondsPerKm,360);
 assert.equal(climb.aheadSeconds,10);
 assert.equal(climb.paceRelation,'faster_than_segment_target');
 assert.equal(climb.nextTerrain,'descent');
 assert.equal(climb.noAutomaticPlanWrite,true);
});
test('behind/ahead includes previous approved segments; no automatic catchup target',()=>{
 const behind=racePaceIndicator(plan(),observation({distanceOnCourseMeters:1500,elapsedSeconds:700,
  recentDistanceMeters:100,recentElapsedSeconds:55}));
 assert.equal(behind.status,'ready');
 if(behind.status!=='ready')return;
 assert.equal(behind.aheadSeconds,-100); // 360 + 240 - 700
 assert.equal(behind.targetSecondsPerKm,480); // never changed to speed up
 assert.equal(behind.paceRelation,'slower_than_segment_target');
 const downhill=racePaceIndicator(plan(),observation({distanceOnCourseMeters:2200,elapsedSeconds:950,
  recentDistanceMeters:100,recentElapsedSeconds:37}));
 assert.equal(downhill.status,'ready');
 if(downhill.status!=='ready')return;
 assert.equal(downhill.sectionId,'descent');
 assert.equal(downhill.targetSecondsPerKm,400);
 assert.equal(downhill.nextTerrain,null);
});
test('GPS trust, route version and source identity mismatch fail closed',()=>{
 for(const altered of [
  {routePositionTrusted:false},{workoutId:'someone-elses-workout'},
  {routeId:'old-route'},{courseVersion:'2026-draft'},
  {distanceOnCourseMeters:3500},{elapsedSeconds:-1},
 ]){
  const result=racePaceIndicator(plan(),observation(altered));
  assert.equal(result.status,'unavailable');
 }
 assert.equal(racePaceIndicator({...plan(),enabled:false},observation()).status,'disabled');
});
test('pauses, low sample distance and likely GPS spikes suppress live speed but keep trusted course section',()=>{
 for(const change of [
  {recordingPaused:true},{recentDistanceMeters:0},{recentElapsedSeconds:10},
  {recentDistanceMeters:10000,recentElapsedSeconds:20},
 ]){
  const result=racePaceIndicator(plan(),observation(change));
  assert.equal(result.status,'ready');
  if(result.status==='ready'){
   assert.equal(result.currentSecondsPerKm,null);
   assert.equal(result.paceRelation,'unknown');
  }
 }
});
test('unverified or discontinuous elevation sections never create a race target',()=>{
 for(const sections of [
  [],
  [{...plan().sections[0],startMeters:200}],
  [plan().sections[0],{...plan().sections[1],startMeters:1100}],
  [{...plan().sections[0],targetSecondsPerKm:Number.NaN}],
  [{...plan().sections[0],gradePercent:120}],
 ]){
  assert.equal(racePaceIndicator({...plan(),sections},observation()).status,'unavailable');
 }
});
test('finish remains tied to last section, not an invented new target',()=>{
 const result=racePaceIndicator(plan(),observation({distanceOnCourseMeters:3000,elapsedSeconds:1250}));
 assert.equal(result.status,'ready');
 if(result.status==='ready'){
  assert.equal(result.sectionId,'descent');
  assert.equal(result.remainingMeters,0);
  assert.equal(result.metersToNextSection,null);
  assert.equal(result.aheadSeconds,-10); // 360 + 480 + 400 - 1250
 }
});
