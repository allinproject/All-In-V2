import test from 'node:test';
import assert from 'node:assert/strict';
import {V2_EXERCISE_PROFILE_DRAFTS} from './exerciseProfileDrafts.ts';
import {validateExerciseScienceProfile} from './exerciseScienceProfile.ts';

test('five source-linked exact exercise variations are structurally valid but remain draft-only',()=>{
  assert.equal(V2_EXERCISE_PROFILE_DRAFTS.length,5);
  const variationIds=V2_EXERCISE_PROFILE_DRAFTS.map(profile=>profile.variationId);
  assert.equal(new Set(variationIds).size,variationIds.length);
  for(const profile of V2_EXERCISE_PROFILE_DRAFTS){
    const result=validateExerciseScienceProfile(profile);
    assert.equal(result.valid,true,profile.variationId);
    if(result.valid){
      assert.equal(result.coachEligible,false,profile.variationId);
      assert.ok(result.sourceCount>0,profile.variationId);
      assert.ok(result.claimCount>0,profile.variationId);
    }
    assert.equal(profile.publicationState,'draft');
  }
});

test('standing and seated calf raise distinctions retain the actual hypertrophy comparison and its limits',()=>{
  const standing=V2_EXERCISE_PROFILE_DRAFTS.find(p=>p.variationId==='machine-standing-calf-raise')!;
  const seated=V2_EXERCISE_PROFILE_DRAFTS.find(p=>p.variationId==='machine-seated-calf-raise')!;
  assert.equal(standing.claims[0].evidenceTier,'within_subject_controlled_intervention');
  assert.equal(seated.claims[0].evidenceTier,'within_subject_controlled_intervention');
  assert.match(standing.claims[0].statement,/greater medial and lateral gastrocnemius/);
  assert.match(seated.claims[0].statement,/soleus volume/);
  assert.match(standing.claims[0].limitations,/untrained/);
  assert.match(seated.claims[0].limitations,/does not establish seated calf raise as a soleus-isolation exercise/);
  assert.ok(standing.jointDemands.some(d=>d.jointId==='knee'&&d.action.includes('near extension')));
  assert.ok(seated.jointDemands.some(d=>d.jointId==='knee'&&d.action.includes('90 degrees')));
});

test('deadlift variation research remains mechanistic EMG evidence, not sport outcome proof',()=>{
  const deadliftDrafts=V2_EXERCISE_PROFILE_DRAFTS.filter(p=>p.movementId==='hip-hinge-deadlift');
  assert.equal(deadliftDrafts.length,3);
  for(const profile of deadliftDrafts){
    assert.equal(profile.sources[0].sourceType,'biomechanical_study');
    assert.equal(profile.claims[0].directness,'mechanistic_rationale');
    assert.equal(profile.claims[0].evidenceTier,'biomechanical_study');
    assert.ok(profile.claims[0].limitations.includes('EMG'));
    assert.ok(!profile.claims.some(claim=>claim.directness==='direct_sport_outcome'));
  }
  const rdl=deadliftDrafts.find(p=>p.variationId==='barbell-romanian-deadlift')!;
  const step=deadliftDrafts.find(p=>p.variationId==='barbell-step-romanian-deadlift')!;
  const stiff=deadliftDrafts.find(p=>p.variationId==='barbell-stiff-leg-deadlift')!;
  assert.match(rdl.claims[0].statement,/semitendinosus excitation/);
  assert.match(step.claims[0].statement,/greater ascending-phase EMG excitation/);
  assert.match(stiff.claims[0].statement,/greater ascending-phase gluteus-maximus excitation/);
});

test('draft research profiles do not introduce a direct running, cycling or swimming performance claim',()=>{
  for(const profile of V2_EXERCISE_PROFILE_DRAFTS){
    for(const claim of profile.claims){
      assert.notEqual(claim.directness,'direct_sport_outcome');
      assert.ok(claim.targetSports.includes('general_fitness'));
    }
  }
});
