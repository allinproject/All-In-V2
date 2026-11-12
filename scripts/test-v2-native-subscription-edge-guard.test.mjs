import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/v2-native-subscription-verify/index.ts',import.meta.url),'utf8');
test('Apple and Android native verification remains default-off with current JWT owner',()=>{
  assert.match(config,/\[functions\.v2-native-subscription-verify\]\s+verify_jwt = true/);
  assert.match(edge,/ALLIN_NATIVE_BILLING_SANDBOX_ARMED"\)!=="true"/);
  assert.match(edge,/db\.auth\.getUser\(authorization\.slice\(7\)\)/);
  assert.match(edge,/verified_for_owner_binding|verifyNativePurchaseForBinding/);
  assert.doesNotMatch(edge,/EXPO_PUBLIC_/);
});
test('native providers must authenticate with server-only Apple roots or Google OAuth',()=>{
  assert.match(edge,/SignedDataVerifier/);
  assert.match(edge,/enableOnlineChecks|Buffer\.from\(c,"base64"\)/);
  assert.match(edge,/ALLIN_APPLE_ROOT_CA_DER_BASE64/);
  assert.match(edge,/ALLIN_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(edge,/createGoogleServiceAccountAccessToken/);
  assert.match(edge,/google_sandbox_evidence_missing/);
});
test('native account context binds store purchases, never client-supplied owner',()=>{
  assert.match(edge,/obfuscatedGoogleBillingAccountId/);
  assert.match(edge,/appAccountToken:owner/);
  assert.match(edge,/v2_billing_find_native_purchase_owner/);
  assert.match(edge,/v2_billing_commit_verified_native/);
  assert.match(edge,/p_owner_id:owner/);
  assert.doesNotMatch(edge,/p_owner_id:\s*(?:evidence|payload|request)\./);
});

test('pending native acknowledgment is non-entitling HTTP 202, not a Supabase transport error',()=>{
  assert.match(edge,/if\(result\.status==="acknowledgement_required"\)\s*(?:\/\/[^\n]*\n\s*)*return reply\(202,"acknowledgement_required"\)/);
  assert.match(edge,/return reply\(503,"verification_unavailable"\)/);
  assert.match(edge,/return reply\(503,"native_billing_disabled"\)/);
  assert.doesNotMatch(edge,/return reply\(200,"acknowledgement_required"\)/);
});
