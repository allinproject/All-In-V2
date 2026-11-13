import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveVerifiedHealthTrainingBaseline,
  healthOnboardingProvider,
  shouldOfferHealthBeforeTraining,
  type VerifiedHealthHistoryWindow,
} from './onboardingHealthBaseline.ts';

const history = (): VerifiedHealthHistoryWindow => ({
  expectedOwnerId: 'owner-a',
  asOf: '2026-11-13T12:00:00Z',
  from: '2026-10-16T12:00:00Z',
  through: '2026-11-13T11:59:00Z',
  authorization: 'confirmed',
  coverage: 'complete',
  workouts: [
    {canonicalActivityId:'a',ownerId:'owner-a',sport:'running',completedAt:'2026-11-01T12:00:00Z',provider:'apple_health',provenance:'authorized_device_import',quality:'trusted'},
    {canonicalActivityId:'b',ownerId:'owner-a',sport:'strength',completedAt:'2026-11-03T12:00:00Z',provider:'apple_health',provenance:'authorized_device_import',quality:'trusted'},
    {canonicalActivityId:'c',ownerId:'owner-a',sport:'treadmill',completedAt:'2026-11-03T15:00:00Z',provider:'apple_health',provenance:'authorized_device_import',quality:'trusted'},
  ],
});
test('platform health offer is explicit, before only Q2, and only with live native capability', () => {
  assert.equal(healthOnboardingProvider('ios'),'apple_health');
  assert.equal(healthOnboardingProvider('android'),'health_connect');
  assert.equal(healthOnboardingProvider('other'),null);
  assert.equal(shouldOfferHealthBeforeTraining({nextStep:'training_pattern', disposition:'not_offered', provider:'apple_health', nativeAuthorizationAvailable:true}),true);
  for(const disposition of ['reviewed','skipped'] as const)assert.equal(shouldOfferHealthBeforeTraining({nextStep:'training_pattern', disposition, provider:'apple_health', nativeAuthorizationAvailable:true}),false);
  assert.equal(shouldOfferHealthBeforeTraining({nextStep:'focus', disposition:'not_offered', provider:'apple_health', nativeAuthorizationAvailable:true}),false);
  assert.equal(shouldOfferHealthBeforeTraining({nextStep:'training_pattern', disposition:'not_offered', provider:'apple_health', nativeAuthorizationAvailable:false}),false);
});
test('V1 28-day history threshold becomes a suggestion, not an automatic confirmed answer',()=>{
  assert.deepEqual(deriveVerifiedHealthTrainingBaseline(history()),{workoutCount:3,activeDays:2,activities:['running','strength'],frequency:'1_2'});
  const one=history();one.workouts=one.workouts.slice(0,2);
  assert.equal(deriveVerifiedHealthTrainingBaseline(one),null);
  const sameDay=history();sameDay.workouts=sameDay.workouts.map(w=>({...w,completedAt:'2026-11-03T12:00:00Z'}));
  assert.equal(deriveVerifiedHealthTrainingBaseline(sameDay),null);
});
test('unverified permission, partial history, wrong owner, duplicates and bad dates fail closed',()=>{
  for(const authorization of ['denied','unknown'] as const){const h=history();h.authorization=authorization;assert.equal(deriveVerifiedHealthTrainingBaseline(h),null);}
  for(const coverage of ['partial','unknown'] as const){const h=history();h.coverage=coverage;assert.equal(deriveVerifiedHealthTrainingBaseline(h),null);}
  const other=history();other.workouts=[...other.workouts.slice(0,2),{...other.workouts[2],ownerId:'owner-b'}];
  assert.equal(deriveVerifiedHealthTrainingBaseline(other),null);
  const duplicate=history();duplicate.workouts=[...duplicate.workouts.slice(0,2),{...duplicate.workouts[2],canonicalActivityId:'a'}];
  assert.equal(deriveVerifiedHealthTrainingBaseline(duplicate),null);
  const untrusted=history();untrusted.workouts=[...untrusted.workouts.slice(0,2),{...untrusted.workouts[2],quality:'unverified'}];
  assert.equal(deriveVerifiedHealthTrainingBaseline(untrusted),null);
  const outside=history();outside.workouts=[...outside.workouts.slice(0,2),{...outside.workouts[2],completedAt:'2025-01-01T00:00:00Z'}];
  assert.equal(deriveVerifiedHealthTrainingBaseline(outside),null);
  const unknownSport=history();unknownSport.workouts=unknownSport.workouts.map(w=>({...w,sport:'unknown'}));
  assert.equal(deriveVerifiedHealthTrainingBaseline(unknownSport),null);
});
