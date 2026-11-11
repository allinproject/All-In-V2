import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../../../app/profile/subscription-billing.tsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../../../app/profile.tsx', import.meta.url), 'utf8');

test('subscription settings are linked from the existing owner-scoped Profile screen', () => {
  assert.match(profile, /href="\/profile\/subscription-billing"/);
  assert.match(screen, /v2AuthenticatedScreenKey\(user\?\.id \?\? null, sessionGeneration\)/);
  assert.match(screen, /gate\.status === 'legal_required'/);
  assert.match(screen, /gate\.status === 'onboarding_required'/);
});

test('subscription display refreshes on focus and never treats backend outages as expiration', () => {
  assert.match(screen, /useFocusEffect\(useCallback\(/);
  assert.match(screen, /readOwnerEntitlement\(ownerId\)/);
  assert.match(screen, /setStatus\('unavailable'\)/);
  assert.match(screen, /setStatus\(result\.entitled \? 'entitled' : 'not_entitled'\)/);
  assert.match(screen, /Refresh subscription status/);
});

test('staged subscription screen has no unsafe client checkout or entitlement writer', () => {
  assert.doesNotMatch(screen, /\.purchase\(|\.restore\(|finishVerifiedPurchase\(|stripe.*checkout/i);
  assert.doesNotMatch(screen, /\.rpc\(|\.from\('v2_.*subscription/);
  assert.match(screen, /No charge can be initiated from this screen/);
  assert.match(screen, /7-day free trial/);
  assert.match(screen, /\$9\.99 per month/);
});
