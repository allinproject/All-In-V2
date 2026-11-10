import test from 'node:test';
import assert from 'node:assert/strict';
import {racePaceObservationFromGpsMatch} from './racePaceGpsAdapter.ts';
import type {RacePacePackage} from './racePaceIndicator.ts';
import type {RaceCourseGpsMatch} from './raceCourseGpsMatcher.ts';

const plan=():RacePacePackage=>({
 workoutId:'workout-race-1',routeId:'route-race-1',courseVersion:'course-v4',enabled:true,
 sections:[
  {id:'flat',startMeters:0,endMeters:1000,targetSecondsPerKm:360,terrain:'flat',gradePercent:0},
  {id:'climb',startMeters:1000,endMeters:2000,targetSecondsPerKm:480,terrain:'climb',gradePercent:8},
 ],
});
const trusted=(patch:Partial<Extract<RaceCourseGpsMatch,{status:'trusted'}>>={}):RaceCourseGpsMatch=>({
 status:'trusted',reason:null,confidence:'high',raceId:'race-1',routeId:'route-race-1',courseVersion:'course-v4',
 distanceOnCourseMeters:900,crossTrackDistanceMeters:3,segmentIndex:4,
 state:{raceId:'race-1',routeId:'route-race-1',courseVersion:'course-v4',segmentIndex:4,capturedAtMs:1000,distanceOnCourseMeters:900},
 ...patch,
});

test('trusted exact-race/course fix binds to the same planned workout and route identity',()=>{
 const result=racePaceObservationFromGpsMatch(plan(),'race-1',trusted(),420,false);
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 assert.equal(result.observation.workoutId,'workout-race-1');
 assert.equal(result.observation.routeId,'route-race-1');
 assert.equal(result.observation.courseVersion,'course-v4');
 assert.equal(result.observation.distanceOnCourseMeters,900);
 assert.equal(result.observation.elapsedSeconds,420);
 assert.equal(result.observation.routePositionTrusted,true);
 assert.equal(result.observation.recentDistanceMeters,0);
 assert.equal(result.observation.recentElapsedSeconds,0);
});

test('untrusted and off-course fixes never become numeric pace observations',()=>{
 const match:RaceCourseGpsMatch={
  status:'untrusted',reason:'GPS fix is too far from the approved course',
  confidence:'untrusted',raceId:'race-1',routeId:'route-race-1',courseVersion:'course-v4',
  distanceOnCourseMeters:null,crossTrackDistanceMeters:130,state:null,
 };
 const result=racePaceObservationFromGpsMatch(plan(),'race-1',match,420,false);
 assert.equal(result.status,'unavailable');
 if(result.status==='unavailable'){
  assert.match(result.reason,/too far/);
  assert.equal(result.observation,null);
 }
});

test('different race or course version is rejected before workout guidance',()=>{
 assert.equal(racePaceObservationFromGpsMatch(plan(),'another-race',trusted(),420,false).status,'unavailable');
 assert.equal(racePaceObservationFromGpsMatch(plan(),'race-1',trusted({courseVersion:'old'}),420,false).status,'unavailable');
 assert.equal(racePaceObservationFromGpsMatch(plan(),'race-1',trusted({routeId:'another-route'}),420,false).status,'unavailable');
});

test('invalid workout time, disabled guidance and out-of-course distance fail closed',()=>{
 assert.equal(racePaceObservationFromGpsMatch(plan(),'race-1',trusted(),-1,false).status,'unavailable');
 assert.equal(racePaceObservationFromGpsMatch({...plan(),enabled:false},'race-1',trusted(),420,false).status,'unavailable');
 assert.equal(racePaceObservationFromGpsMatch(plan(),'race-1',trusted({distanceOnCourseMeters:2100}),420,false).status,'unavailable');
});
