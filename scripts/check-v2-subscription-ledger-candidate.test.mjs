import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/architecture/sql/V2-SUBSCRIPTION-VERIFIED-LEDGER-CANDIDATE.sql',import.meta.url),'utf8');

test('subscription SQL is review-only and cannot silently be treated as a migration',()=>{
  assert.match(sql,/REVIEW-ONLY/i);
  assert.match(sql,/NOT A MIGRATION/i);
  assert.match(sql,/DO NOT APPLY/i);
});

test('canonical purchase identity is unique and bound to existing V2 profile',()=>{
  assert.match(sql,/owner_id uuid not null references public\.v2_profiles\(user_id\)/);
  assert.match(sql,/unique \(provider,environment,provider_subscription_id\)/);
  assert.match(sql,/v_purchase\.owner_id <> p_owner_id/);
});

test('events have unique provider identity and revision within one purchase',()=>{
  assert.match(sql,/unique\(provider,environment,provider_event_id\)/);
  assert.match(sql,/unique\(purchase_id,revision\)/);
  assert.match(sql,/p_revision <= v_purchase\.revision/);
  assert.match(sql,/v_event_purchase_id <> v_purchase\.id/);
});

test('writer serializes identity resolution and row mutation under transaction lock',()=>{
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/for update;/);
  assert.match(sql,/insert into allin_private\.v2_subscription_verified_events/);
  assert.match(sql,/update allin_private\.v2_subscription_purchases/);
});

test('private tables enforce RLS and no direct web-client access',()=>{
  assert.match(sql,/alter table allin_private\.v2_subscription_purchases enable row level security/);
  assert.match(sql,/alter table allin_private\.v2_subscription_verified_events enable row level security/);
  assert.match(sql,/revoke all on allin_private\.v2_subscription_purchases from public, anon, authenticated/);
  assert.match(sql,/revoke all on allin_private\.v2_subscription_verified_events from public, anon, authenticated/);
  assert.match(sql,/current_user <> 'service_role'/);
  assert.match(sql,/security invoker/);
});

test('paid access is explicitly bounded and retry is not access',()=>{
  assert.match(sql,/phase in \('trial','paid','grace','canceling'\)/);
  assert.match(sql,/then p_access_until else null end/);
  assert.match(sql,/phase not in \('trial','paid','grace','canceling'\) or access_until is not null/);
});

test('webhook writer can never claim an unbound provider purchase', () => {
  assert.match(sql,/if not found then\s+raise exception 'subscription purchase is not prebound/);
  assert.doesNotMatch(sql,/if not found then\s+insert into allin_private\.v2_subscription_purchases/);
  assert.match(sql,/purchase-binding workflow BEFORE this function can apply an event/);
});

test('confirmed checkout provenance is mandatory for each purchase identity', () => {
  assert.match(sql,/create table allin_private\.v2_subscription_checkout_attempts/);
  assert.match(sql,/state text not null default 'server_confirmed'/);
  assert.match(sql,/checkout_attempt_id uuid not null unique/);
  assert.match(sql,/v2_subscription_checkout_provenance foreign key/);
  assert.match(sql,/alter table allin_private\.v2_subscription_checkout_attempts enable row level security/);
  assert.match(sql,/revoke all on allin_private\.v2_subscription_checkout_attempts from public, anon, authenticated/);
});
