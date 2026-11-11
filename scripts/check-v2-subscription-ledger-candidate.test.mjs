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
  assert.match(sql,/v2_subscription_checkout_attempts BEFORE this function can apply an event/);
});

test('confirmed checkout provenance is mandatory for each purchase identity', () => {
  assert.match(sql,/create table allin_private\.v2_subscription_checkout_attempts/);
  assert.match(sql,/state text not null\s+check \(state in \('reserved','pending','server_confirmed'\)\)/);
  assert.match(sql,/v2_checkout_state_provenance check/);
  assert.match(sql,/state = 'reserved' and provider_checkout_id is null/);
  assert.match(sql,/state = 'pending' and provider_checkout_id is not null and\s+provider_subscription_id is null and verified_at is null/);
  assert.doesNotMatch(sql,/state text not null default/);
  assert.match(sql,/checkout_attempt_id uuid not null unique/);
  assert.match(sql,/v2_subscription_checkout_provenance foreign key/);
  assert.match(sql,/alter table allin_private\.v2_subscription_checkout_attempts enable row level security/);
  assert.match(sql,/revoke all on allin_private\.v2_subscription_checkout_attempts from public, anon, authenticated/);
});

test('confirmed checkout binder is service-only, locked and owner-idempotent', () => {
  assert.match(sql,/create or replace function allin_private\.v2_bind_confirmed_subscription_purchase\(/);
  assert.match(sql,/purchase binding requires service role/);
  assert.match(sql,/attempt_id=p_attempt_id and state='server_confirmed'/);
  assert.match(sql,/v_purchase\.owner_id <> v_attempt\.owner_id/);
  assert.match(sql,/v_purchase\.checkout_attempt_id <> v_attempt\.attempt_id/);
  assert.match(sql,/return 'already_bound'/);
  assert.match(sql,/revoke all on function allin_private\.v2_bind_confirmed_subscription_purchase\(uuid\)/);
});

test('pending and confirmation service transitions are identity locked and private',()=>{
  assert.match(sql,/create or replace function allin_private\.v2_register_pending_subscription_checkout\(/);
  assert.match(sql,/p_authenticated_owner_id is distinct from p_owner_id/);
  assert.match(sql,/create or replace function allin_private\.v2_confirm_pending_subscription_checkout\(/);
  assert.match(sql,/v_attempt\.owner_id <> p_owner_id/);
  assert.match(sql,/v_attempt\.provider_checkout_id <> p_provider_checkout_id/);
  assert.match(sql,/revoke all on function allin_private\.v2_register_pending_subscription_checkout/);
  assert.match(sql,/revoke all on function allin_private\.v2_confirm_pending_subscription_checkout/);
});

test('durable reservation precedes pending provider checkout',()=>{
  assert.match(sql,/create or replace function allin_private\.v2_reserve_subscription_checkout\(/);
  assert.match(sql,/checkout must be reserved before provider session is created/);
  assert.match(sql,/revoke all on function allin_private\.v2_reserve_subscription_checkout/);
  assert.match(sql,/checkout reservation identity collision/);
});

test('atomic checkout finalization remains service-only and preserves original binding',()=>{
  assert.match(sql,/create or replace function allin_private\.v2_finalize_verified_subscription_checkout/);
  assert.match(sql,/checkout finalization requires service role/);
  assert.match(sql,/v2_confirm_pending_subscription_checkout\(/);
  assert.match(sql,/v2_bind_confirmed_subscription_purchase\(p_attempt_id\)/);
  assert.match(sql,/revoke all on function allin_private\.v2_finalize_verified_subscription_checkout/);
});

test('authoritative trial claim serializes account and enforces cross-provider one-trial rule',()=>{
  assert.match(sql,/create or replace function allin_private\.v2_claim_trial_checkout_attempt/);
  assert.match(sql,/p_authenticated_owner_id is distinct from p_owner_id/);
  assert.match(sql,/hashtextextended\('trial:' \|\| p_owner_id::text,0\)/);
  assert.match(sql,/trial_ineligible/);
  assert.match(sql,/trial_unavailable/);
  assert.match(sql,/revoke all on function allin_private\.v2_claim_trial_checkout_attempt/);
});

test('active checkout unique constraint defends against privileged direct duplicates',()=>{
  assert.match(sql,/create unique index v2_subscription_one_active_checkout_per_owner_idx/);
  assert.match(sql,/on allin_private\.v2_subscription_checkout_attempts\(owner_id\)/);
  assert.match(sql,/where state in \('reserved','pending'\)/);
});

test('returning-customer paid claim is isolated from first-trial eligibility',()=>{
  assert.match(sql,/offer_kind text not null default 'trial'/);
  assert.match(sql,/create or replace function allin_private\.v2_claim_paid_checkout_attempt/);
  assert.match(sql,/not_returning_customer/);
  assert.match(sql,/subscription_unresolved/);
  assert.match(sql,/p\.revision=0 or p\.phase not in \('expired','refunded','revoked'\)/);
  assert.match(sql,/a\.offer_kind='paid'/);
  assert.match(sql,/revoke all on function allin_private\.v2_claim_paid_checkout_attempt/);
});

test('event updates and checkout finalization take owner lock before purchase mutations',()=>{
  const marker="hashtextextended('trial:' || p_owner_id::text,0)";
  const event=sql.slice(sql.indexOf('create or replace function allin_private.v2_apply_verified_subscription_event('));
  const finalizer=sql.slice(sql.indexOf('create or replace function allin_private.v2_finalize_verified_subscription_checkout('),
    sql.indexOf('revoke all on function allin_private.v2_finalize_verified_subscription_checkout('));
  assert.ok(event.includes(marker));
  assert.ok(finalizer.includes(marker));
});

test('public billing RPC bridge is invoker-only and denies all client roles',()=>{
  const names=[
    'v2_billing_claim_trial_checkout','v2_billing_claim_paid_checkout',
    'v2_billing_register_pending_checkout','v2_billing_finalize_checkout',
    'v2_billing_lookup_checkout','v2_billing_apply_current_subscription_event',
  ];
  for(const name of names){
    const start=sql.indexOf('create or replace function public.'+name+'(');
    assert.ok(start>=0,name+' missing');
    const body=sql.slice(start,sql.indexOf('revoke all on function public.'+name,start));
    assert.match(body,/security invoker/);
    assert.match(body,/current_user <> 'service_role'/);
    assert.match(sql.slice(start),new RegExp('revoke all on function public\\.'+name+'\\('));
  }
});
