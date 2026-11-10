import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePendingLegalAcceptance, shouldEnterV2Onboarding } from './accessGateClient.ts';

const validAcceptance = {
  terms_version: 'terms-of-use-v1',
  privacy_version: 'privacy-policy-v1',
  founder_beta_terms_version: 'founder-beta-terms-v1',
  age_18_confirmed: true,
  accepted_at: '2026-11-09T19:00:00.000Z',
};

test('pending legal acceptance requires all exact versions, age confirmation and canonical timestamp', () => {
  assert.ok(parsePendingLegalAcceptance(validAcceptance));
  assert.equal(parsePendingLegalAcceptance({ ...validAcceptance, age_18_confirmed: false }), null);
  assert.equal(parsePendingLegalAcceptance({ ...validAcceptance, terms_version: 'pending-final-terms' }), null);
  assert.equal(parsePendingLegalAcceptance({ ...validAcceptance, accepted_at: 'not-a-date' }), null);
});

test('completed onboarding metadata closes the onboarding gate', () => {
  assert.equal(shouldEnterV2Onboarding({ allin_training_onboarding_complete: true }, {
    completedSteps: [], skippedSteps: [],
  }), false);
});

test('existing partial onboarding remains required', () => {
  assert.equal(shouldEnterV2Onboarding({}, {
    completedSteps: ['focus'], skippedSteps: [],
  }), true);
});

test('legacy configured accounts are not sent back through first-run onboarding', () => {
  assert.equal(shouldEnterV2Onboarding({ allin_active_activities: ['run'] }, {
    completedSteps: [], skippedSteps: [],
  }), false);
  assert.equal(shouldEnterV2Onboarding({ allin_capability_interests: ['strength'] }, {
    completedSteps: [], skippedSteps: [],
  }), false);
});

test('unconfigured new accounts remain on the onboarding path', () => {
  assert.equal(shouldEnterV2Onboarding({}, {
    completedSteps: [], skippedSteps: [],
  }), true);
});