import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const edge=readFileSync(new URL('../supabase/functions/v2-stripe-sandbox-checkout/index.ts',
  import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');

test('sandbox Checkout endpoint is default OFF with platform JWT required',()=>{
  assert.match(config,/\[functions\.v2-stripe-sandbox-checkout\]\s+verify_jwt = true/);
  assert.match(edge,/Deno\.env\.get\("ALLIN_BILLING_SANDBOX_ARMED"\) !== "true"/);
  assert.match(edge,/db\.auth\.getUser\(token\)/);
  assert.doesNotMatch(edge,/verify_jwt\s*=\s*false/);
});
test('server-only secrets and service RPCs never use client request claims',()=>{
  assert.match(edge,/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(edge,/Deno\.env\.get\("ALLIN_STRIPE_SANDBOX_SECRET_KEY"\)/);
  assert.match(edge,/v2_billing_claim_trial_checkout/);
  assert.match(edge,/v2_billing_claim_paid_checkout/);
  assert.match(edge,/v2_billing_verify_checkout_reservation/);
  assert.match(edge,/v2_billing_register_pending_checkout/);
  assert.match(edge,/body_not_allowed/);
  assert.doesNotMatch(edge,/EXPO_PUBLIC_/);
});
test('web return origin is explicit, HTTPS, and non-wildcard',()=>{
  assert.match(edge,/ALLIN_BILLING_RETURN_ORIGIN/);
  assert.match(edge,/u\.protocol === "https:"/);
  assert.match(edge,/req\.headers\.get\("origin"\) !== origin/);
  assert.doesNotMatch(edge,/"access-control-allow-origin": "\*"/);
});
