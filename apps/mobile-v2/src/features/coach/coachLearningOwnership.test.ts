import test from 'node:test';
import assert from 'node:assert/strict';
import {
  learningDestination, isReviewableLearning, isConfirmedLearning,
  eligibleForCoachLearningReset, type CoachLearningRecord,
} from './coachLearningOwnership.ts';

const row = (topic: CoachLearningRecord['topic'], state: CoachLearningRecord['state']): CoachLearningRecord => ({
  id: topic + ':' + state,
  topic,state,source: 'coach_inference',summary: 'Example',evidence: null,updatedAt: null,
});

test('known structured facts route to existing canonical owners, not learning storage',()=>{
  assert.deepEqual(learningDestination('kitchen_equipment'),{kind:'canonical',owner:'kitchen'});
  assert.deepEqual(learningDestination('coaching_tone'),{kind:'canonical',owner:'coach_preferences'});
  assert.deepEqual(learningDestination('food_allergy'),{kind:'canonical',owner:'nutrition'});
  assert.deepEqual(learningDestination('notification_frequency'),{kind:'canonical',owner:'notifications'});
  assert.deepEqual(learningDestination('sports_activities'),{kind:'canonical',owner:'training'});
});

test('Coach-owned feedback can be proposed and confirmed but inferencing is not auto-confirmation',()=>{
  assert.deepEqual(learningDestination('workout_feedback'),{kind:'coach_learning'});
  assert.equal(isReviewableLearning(row('workout_feedback','proposed')),true);
  assert.equal(isConfirmedLearning(row('workout_feedback','proposed')),false);
  assert.equal(isConfirmedLearning(row('workout_feedback','confirmed')),true);
  assert.equal(isReviewableLearning(row('workout_feedback','dismissed')),false);
});

test('structured profile facts never appear as duplicate learnings',()=>{
  assert.equal(isReviewableLearning(row('kitchen_equipment','proposed')),false);
  assert.equal(isConfirmedLearning(row('explanation_detail','confirmed')),false);
});

test('reset only targets active Coach-owned learning, never user data in canonical stores',()=>{
  assert.deepEqual(eligibleForCoachLearningReset([
    row('workout_feedback','confirmed'),
    row('recovery_feedback','proposed'),
    row('training_pattern','dismissed'),
    row('kitchen_equipment','confirmed'),
    row('coaching_tone','proposed'),
  ]),['workout_feedback:confirmed','recovery_feedback:proposed']);
});
