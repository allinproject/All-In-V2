import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkoutDebriefEvidence} from './workoutDebriefEvidence.ts';
import type {AthleteHistoryReadModel,AthleteHistoryEvent} from './athleteHistoryContext.ts';
const event=(patch:Partial<AthleteHistoryEvent>={}):AthleteHistoryEvent=>({
 id:'run-2',kind:'completed_session',sport:'running',occurredAt:'2026-11-09T09:00:00Z',
 recordedAt:'2026-11-09T10:00:00Z',source:'canonical_training',sourceRef:'tracked-run',
 canonicalRef:'run-owner-2',planId:'plan-1',planRevision:2,summary:'Long outdoor run',
 metrics:{sessionPurpose:'endurance_long',durationMinutes:110,distanceMiles:10,
  averageHeartRateBpm:145},confidence:'high',...patch,
});
const history=(events:AthleteHistoryEvent[],completeness:AthleteHistoryReadModel['completeness']='complete_for_requested_scope'):AthleteHistoryReadModel=>({
 version:1,generatedAt:'2026-11-10T13:00:00Z',
 requested:{fromDate:'2026-10-01',throughDate:'2026-11-09',sports:['running']},
 currentPlan:{id:'plan-1',revision:2,weekStart:'2026-11-09',status:'accepted'},
 restrictions:[],coverage:[],events,completeness,warnings:[],
});
test('same-purpose comparisons are sourced; no coaching copy or imagined causes',()=>{
 const current=event(),previous=event({id:'run-1',occurredAt:'2026-11-02T09:00:00Z',
  metrics:{sessionPurpose:'endurance_long',durationMinutes:105,distanceMiles:9.5,averageHeartRateBpm:147}});
 const result=buildWorkoutDebriefEvidence({history:history([current,previous]),sessionId:'run-2',
  sessionPurpose:'endurance_long'});
 assert.equal(result.status,'ready');
 assert.deepEqual(result.comparisons.map(x=>x.measure),
  ['durationMinutes','distanceMiles','averageHeartRateBpm']);
 assert.equal(result.comparisons[1].difference,0.5);
 assert.equal(result.policy.noInferredCause,true);
 assert.equal(result.policy.noAutomaticWrite,true);
});
test('different sport, purpose or missing history prevents fabricated improvement',()=>{
 const current=event(),bike=event({id:'ride-1',sport:'cycling',
  occurredAt:'2026-11-02T09:00:00Z'}),other=event({id:'run-1',
  occurredAt:'2026-11-01T09:00:00Z',metrics:{sessionPurpose:'recovery',distanceMiles:5}});
 for(const past of [bike,other]){
  const result=buildWorkoutDebriefEvidence({history:history([current,past]),sessionId:'run-2',
   sessionPurpose:'endurance_long'});
  assert.equal(result.comparisons.length,0);
 }
 const partial=buildWorkoutDebriefEvidence({history:history([current,other],'partial'),
  sessionId:'run-2',sessionPurpose:'endurance_long'});
 assert.equal(partial.comparisons.length,0);
 assert.ok(partial.warnings.some(w=>w.includes('incomplete')));
});
test('missing, duplicated, low confidence and unbound completed workout cannot be interpreted',()=>{
 const current=event();
 for(const events of [[],[current,current],[event({canonicalRef:null})],
  [event({confidence:'low'})]]){
  assert.equal(buildWorkoutDebriefEvidence({
   history:history(events),sessionId:'run-2',
  }).status,'insufficient_evidence');
 }
});
test('a completed manual walk is legitimate without invented running metrics',()=>{
 const walk=event({id:'walk-1',sport:'walking',source:'manual_entry',summary:'Ten-minute walk',
  metrics:{durationMinutes:10},canonicalRef:'manual-1'});
 const result=buildWorkoutDebriefEvidence({history:history([walk]),sessionId:'walk-1'});
 assert.equal(result.status,'ready');
 assert.deepEqual(result.observations.map(x=>x.measure),['durationMinutes']);
 assert.equal(result.comparisons.length,0);
 assert.equal(result.sport,'walking');
});
test('invalid numbers never enter evidence or produce comparisons',()=>{
 const run=event({metrics:{durationMinutes:-10,distanceMiles:1000000,averageHeartRateBpm:1000,rpe:11}});
 const result=buildWorkoutDebriefEvidence({history:history([run]),sessionId:'run-2'});
 assert.equal(result.status,'ready');
 assert.equal(result.observations.length,0);
 assert.ok(result.warnings.some(w=>w.includes('numeric')));
});
