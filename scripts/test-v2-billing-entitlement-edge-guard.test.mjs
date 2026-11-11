import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const edge=readFileSync(new URL('../supabase/functions/v2-billing-entitlement/index.ts',
  import.meta.url),'utf8');
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
test('entitlement endpoint requires JWT and remains default OFF',()=>{
  assert.match(config,/\[functions\.v2-billing-entitlement\]\s+verify_jwt = true/);
  assert.match(edge,/ALLIN_BILLING_ENTITLEMENT_ARMED"\)!=="true"/);
  assert.match(edge,/client\.auth\.getUser\(auth\.slice\(7\)\)/);
  assert.match(edge,/req\.method!=="GET"/);
});
test('read-only entitlement is owner-scoped, sandbox-only and contains no purchase identifiers',()=>{
  assert.match(edge,/v2_billing_read_owner_access/);
  assert.match(edge,/p_owner_id:owner,p_environment:"sandbox"/);
  assert.match(edge,/entitled:data\[0\]\.entitled/);
  assert.match(edge,/accessUntil:data\[0\]\.entitled\?data\[0\]\.access_until:null/);
  assert.doesNotMatch(edge,/EXPO_PUBLIC_|checkoutUrl|providerSubscriptionId|providerEventId/);
});
