import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const edge=readFileSync(new URL('../supabase/functions/v2-stripe-sandbox-webhook/index.ts',
  import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');

test('Stripe sandbox webhook entry is default OFF and requires signed raw body',()=>{
  assert.match(config,/\[functions\.v2-stripe-sandbox-webhook\]\s+verify_jwt = false/);
  assert.match(edge,/ALLIN_STRIPE_SANDBOX_WEBHOOK_ARMED"\)!=="true"/);
  assert.match(edge,/req\.headers\.get\("stripe-signature"\)/);
  assert.match(edge,/reconcileStripeSandboxWebhook/);
  assert.match(edge,/rawBody=await readLimited\(req,256\*1024\)/);
  assert.doesNotMatch(edge,/"access-control-allow-origin": "\*"/);
});
test('webhook reads authenticated merchant state and only canonical private service RPCs',()=>{
  assert.match(edge,/ALLIN_STRIPE_SANDBOX_SECRET_KEY/);
  assert.match(edge,/ALLIN_STRIPE_SANDBOX_WEBHOOK_SECRETS/);
  assert.match(edge,/v2_billing_lookup_checkout/);
  assert.match(edge,/v2_billing_finalize_checkout/);
  assert.match(edge,/v2_billing_lookup_purchase/);
  assert.match(edge,/v2_billing_apply_current_subscription_event/);
  assert.match(edge,/currentProviderSubscription|verifiedProjection/);
  assert.doesNotMatch(edge,/EXPO_PUBLIC_/);
});
