import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSandboxSubscriptionOffer } from './offerPolicy.ts';

const ios = Object.freeze({
  surface: 'ios_native',
  provider: 'app_store',
  currency: 'usd',
  amountMinor: 999,
  billingInterval: 'month',
  billingIntervalCount: 1,
  trialDays: 7,
  trialEligible: true,
  providerOfferId: 'internal-storekit-test-product',
});

test('approved iOS and Android monthly trial candidates are test-only', () => {
  assert.equal(reviewSandboxSubscriptionOffer(ios), 'approved_for_test');
  assert.equal(reviewSandboxSubscriptionOffer({...ios, surface:'android_native', provider:'google_play',
    providerOfferId:'internal-play-test-product'}), 'approved_for_test');
});

test('verified matching $9.99 sandbox Stripe price is web-only', () => {
  const web = {...ios, surface:'web', provider:'stripe_web', providerOfferId:'price_1UaDovRBJdOnJBog5swb8zpS'};
  assert.equal(reviewSandboxSubscriptionOffer(web), 'approved_for_test');
  assert.equal(reviewSandboxSubscriptionOffer({...web, surface:'ios_native'}), 'not_approved');
  assert.equal(reviewSandboxSubscriptionOffer({...web, surface:'android_native'}), 'not_approved');
  assert.equal(reviewSandboxSubscriptionOffer({...web, providerOfferId:'another-price'}), 'not_approved');
});

test('unapproved $15 test price, annual plan and extra upsells are rejected', () => {
  assert.equal(reviewSandboxSubscriptionOffer({...ios, amountMinor:1500}), 'not_approved');
  assert.equal(reviewSandboxSubscriptionOffer({...ios, billingInterval:'year'}), 'not_approved');
  assert.equal(reviewSandboxSubscriptionOffer({...ios, billingIntervalCount:12}), 'not_approved');
  assert.equal(reviewSandboxSubscriptionOffer({...ios, trialDays:30}), 'not_approved');
  assert.equal(reviewSandboxSubscriptionOffer({...ios, currency:'eur'}), 'not_approved');
});

test('trial eligibility is not inferred and cannot be reissued', () => {
  assert.equal(reviewSandboxSubscriptionOffer({...ios, trialEligible:false}), 'ineligible_trial');
  assert.equal(reviewSandboxSubscriptionOffer({...ios, trialEligible:true, trialDays:0}), 'not_approved');
});

test('malformed and unknown checkout candidates are rejected', () => {
  for (const candidate of [
    {...ios, surface:'other'},
    {...ios, provider:'stripe_web'},
    {...ios, amountMinor:NaN},
    {...ios, amountMinor:999.5},
    {...ios, providerOfferId:''},
    {...ios, billingIntervalCount:0},
  ]) assert.equal(reviewSandboxSubscriptionOffer(candidate), 'not_approved');
});
