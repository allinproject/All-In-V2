import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../../../app/profile/account-deletion.tsx', import.meta.url), 'utf8');

test('deletion is initiated only for authenticated active owner with explicit confirmation', () => {
  assert.match(screen, /assertV2SessionOwner\(supabase, owner\)/);
  assert.match(screen, /rpc\('v2_request_account_deletion'/);
  assert.match(screen, /p_expected_user_id: owner/);
  assert.match(screen, /confirmation !== 'DELETE MY ACCOUNT'/);
  assert.match(screen, /if \(!authLoading && !user\) return <Redirect href="\/sign-in"/);
});

test('request status and cancellation stay owner-bound and idempotently reconcile lost responses', () => {
  assert.match(screen, /rpc\('v2_my_account_deletion_request'/);
  assert.match(screen, /rpc\('v2_cancel_account_deletion_request'/);
  assert.match(screen, /p_expected_request_id: requestId/);
  assert.match(screen, /latest\.status === 'requested' \|\| latest\.status === 'processing'/);
  assert.match(screen, /latest\.status === 'cancelled' && latest\.requestId === requestId/);
  assert.doesNotMatch(screen, /auth\.admin\.deleteUser|\.deleteUser\(/);
});

test('user sees store cancellation warning, real management links, and truthful unarmed processor status', () => {
  assert.match(screen, /does not cancel an Apple App Store or Google Play subscription/);
  assert.match(screen, /https:\/\/apps\.apple\.com\/account\/subscriptions/);
  assert.match(screen, /https:\/\/play\.google\.com\/store\/account\/subscriptions/);
  assert.match(screen, /secure deletion processor is not enabled yet/);
  assert.match(screen, /does not immediately erase anything/);
});
