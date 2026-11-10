import test from 'node:test';
import assert from 'node:assert/strict';
import {racePaceRemainingStrategy} from './racePaceRemainingStrategy.ts';
import type {RacePacePackage,RacePaceObservation} from './racePaceIndicator.ts';

const plan=():RacePacePackage=>({
 workoutId:'race-one',routeId:'course-one',courseVersion:'final-v3',enabled:true,
 sections:[
  {id:'flat',startMeters:0,endMeters:1000,targetSecondsPerKm:360,terrain:'flat',gradePercent:0},
  {id:'climb',startMeters:1000,endMeters:2000,targetSecondsPerKm:480,terrain:'climb',gradePercent:8},
  {id:'downhill',startMeters:2000,endMeters:3000,targetSecondsPerKm:410,terrain:'descent',gradePercent:-9},
 ],
});
const sample=(patch:Partial<RacePaceObservation>={}):RacePaceObservation=>({
 workoutId:'race-one',routeId:'course-one',courseVersion:'final-v3',
 elapsedSeconds:700,distanceOnCourseMeters:1500,recentElapsedSeconds:40,
 recentDistanceMeters:100,routePositionTrusted:true,recordingPaused:false,...patch,
});

test('remaining projection recalculates from elapsed progress and approved per-section targets',()=>{
 const result=racePaceRemainingStrategy(plan(),sample(),1400);
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 // Remaining: 500m climb at 480s/km + 1000m descent at 410s/km.
 assert.equal(result.remainingMeters,1500);
 assert.equal(result.remainingApprovedSeconds,650);
 assert.equal(result.projectedFinishSeconds,1350);
 assert.equal(Math.round(result.approvedRemainingAverageSecondsPerKm!),Math.round(650/1.5));
 assert.equal(result.projectedGoalDeltaSeconds,-50);
 assert.equal(result.goalAssessment,'ahead_of_goal_projection');
 assert.equal(result.recommendedAction,'continue_approved_segments');
 assert.equal(result.proposedCatchUpSecondsPerKm,null);
 assert.equal(result.noAutomaticPlanWrite,true);
});

test('late progress that would require faster than approved targets is not turned into a catch-up command',()=>{
 const result=racePaceRemainingStrategy(plan(),sample({elapsedSeconds:900}),1300);
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 assert.equal(result.remainingApprovedSeconds,650);
 assert.equal(result.projectedFinishSeconds,1550);
 assert.equal(result.projectedGoalDeltaSeconds,250);
 assert.equal(result.goalAssessment,'requires_faster_than_approved_strategy');
 assert.equal(result.recommendedAction,'preserve_effort_and_revise_finish_expectation');
 assert.equal(Math.round(result.requiredRemainingSecondsPerKm!),267);
 assert.equal(Math.round(result.approvedRemainingAverageSecondsPerKm!),Math.round(650/1.5));
 assert.equal(result.proposedCatchUpSecondsPerKm,null);
});

test('un-timed effort strategy does not invent a finish target or pace',()=>{
 const result=racePaceRemainingStrategy(plan(),sample());
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 assert.equal(result.goalAssessment,'no_goal');
 assert.equal(result.targetFinishSeconds,null);
 assert.equal(result.requiredRemainingSecondsPerKm,null);
 assert.equal(result.proposedCatchUpSecondsPerKm,null);
});

test('unknown route position, stale course identity and invalid goal fail closed',()=>{
 for(const [observation,goal] of [
  [sample({routePositionTrusted:false}),1400],
  [sample({courseVersion:'draft'}),1400],
  [sample({routeId:'other'}),1400],
  [sample(),-1],
  [sample(),Infinity],
 ] as const){
  const result=racePaceRemainingStrategy(plan(),observation,goal);
  assert.equal(result.status,'unavailable');
 }
});

test('when approved elapsed goal is already past, guidance preserves effort without unsafe acceleration',()=>{
 const result=racePaceRemainingStrategy(plan(),sample({elapsedSeconds:1400}),1300);
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 assert.equal(result.goalAssessment,'goal_time_elapsed');
 assert.equal(result.recommendedAction,'preserve_effort_and_revise_finish_expectation');
 assert.equal(result.proposedCatchUpSecondsPerKm,null);
});

test('finish state reports actual elapsed time and never invents remaining pace',()=>{
 const result=racePaceRemainingStrategy(plan(),sample({
  distanceOnCourseMeters:3000,elapsedSeconds:1700,
 }),1400);
 assert.equal(result.status,'ready');
 if(result.status!=='ready')return;
 assert.equal(result.remainingMeters,0);
 assert.equal(result.projectedFinishSeconds,1700);
 assert.equal(result.goalAssessment,'finished');
 assert.equal(result.requiredRemainingSecondsPerKm,null);
});
