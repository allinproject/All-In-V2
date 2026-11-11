import test from 'node:test';
import assert from 'node:assert/strict';
import { navigation } from '../theme/tokens.ts';
import { v2SelectedTab, v2TabRoutes } from './v2TabRoutes.ts';

test('each of the five approved V2 tabs owns one unique route', () => {
  assert.deepEqual(navigation, ['Today', 'Fuel', 'Train', 'Community', 'Coach']);
  assert.deepEqual(v2TabRoutes, ['/home', '/fuel', '/train', '/community', '/coach']);
  assert.equal(new Set(v2TabRoutes).size, navigation.length);
  for (let i = 0; i < navigation.length; i++) {
    assert.equal(v2SelectedTab(v2TabRoutes[i]), navigation[i]);
  }
});

test('nested routes stay selected only inside their own workspace', () => {
  assert.equal(v2SelectedTab('/train/history'), 'Train');
  assert.equal(v2SelectedTab('/train/'), 'Train');
  assert.equal(v2SelectedTab('/coach/thread/123'), 'Coach');
  assert.equal(v2SelectedTab('/trainer'), null);
  assert.equal(v2SelectedTab('/homework'), null);
});

test('auth, legal, onboarding and unrecognized routes do not imply app access', () => {
  for (const route of ['/', '/sign-in', '/sign-up', '/legal-acceptance', '/onboarding-required', '/auth/callback', '/add-workout', '/profile', '']) {
    assert.equal(v2SelectedTab(route), null);
  }
});
