-- ALL-252 / ALL-222 — REVIEW-ONLY subscription owner/receipt candidate.
-- THIS IS NOT A MIGRATION. DO NOT APPLY WITHOUT OWNER/SECURITY APPROVAL
-- AND ISOLATED TWO-USER POSTGRES CONCURRENCY + RLS REPLAY.
--
-- Important trust boundary: the service-role caller MUST authenticate provider
-- signatures, retrieve authoritative current state and bind provider purchase
-- identity to its rightful immutable V2 account BEFORE invoking the writer.
-- The SQL below cannot authenticate a webhook and is not an HTTP endpoint.
-- Avoid provider payment tokens, raw webhook JSON, customer email/PII in tables.

create table allin_private.v2_subscription_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  provider text not null check (provider in ('app_store','google_play','stripe_web')),
  environment text not null check (environment in ('sandbox','production')),
  provider_subscription_id text not null
    check (length(provider_subscription_id) between 1 and 256),
  revision bigint not null default 0 check (revision >= 0),
  phase text not null default 'expired'
    check (phase in ('trial','paid','grace','billing_retry','canceling','expired','refunded','revoked')),
  access_until timestamptz,
  last_provider_event_id text,
  updated_at timestamptz not null default now(),
  unique (provider,environment,provider_subscription_id),
  constraint v2_subscription_bounded_access check (
    phase not in ('trial','paid','grace','canceling') or access_until is not null
  )
);

create index v2_subscription_purchases_owner_idx
  on allin_private.v2_subscription_purchases(owner_id);

create table allin_private.v2_subscription_verified_events (
  id bigint generated always as identity primary key,
  purchase_id uuid not null
    references allin_private.v2_subscription_purchases(id) on delete cascade,
  provider text not null check (provider in ('app_store','google_play','stripe_web')),
  environment text not null check (environment in ('sandbox','production')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 256),
  revision bigint not null check (revision > 0),
  accepted_at timestamptz not null default now(),
  unique(provider,environment,provider_event_id),
  unique(purchase_id,revision)
);

-- Deny direct API mutations/reads; a separately reviewed, authenticated owner
-- projection function may eventually expose sanitized derived access.
alter table allin_private.v2_subscription_purchases enable row level security;
alter table allin_private.v2_subscription_verified_events enable row level security;
revoke all on allin_private.v2_subscription_purchases from public, anon, authenticated;
revoke all on allin_private.v2_subscription_verified_events from public, anon, authenticated;
revoke all on sequence allin_private.v2_subscription_verified_events_id_seq
  from public, anon, authenticated;

-- Privileged service-only transaction. Strictly store verified facts only:
-- no client grants and no exposed RPC. New purchase binding requires a trusted
-- checkout/restore authorization decision recorded in a separately reviewed\n-- purchase-binding workflow BEFORE this function can apply an event.
create or replace function allin_private.v2_apply_verified_subscription_event(
  p_owner_id uuid,
  p_provider text,
  p_environment text,
  p_subscription_id text,
  p_event_id text,
  p_revision bigint,
  p_phase text,
  p_access_until timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase allin_private.v2_subscription_purchases%rowtype;
  v_event_purchase_id uuid;
begin
  -- GRANT EXECUTE only to the service_role after independent review.
  if current_user <> 'service_role' then
    raise exception 'subscription writer requires service role' using errcode='42501';
  end if;
  if p_owner_id is null or p_provider not in ('app_store','google_play','stripe_web')
     or p_environment not in ('sandbox','production')
     or p_subscription_id is null or length(p_subscription_id) not between 1 and 256
     or p_event_id is null or length(p_event_id) not between 1 and 256
     or p_revision is null or p_revision < 1
     or p_phase not in ('trial','paid','grace','billing_retry','canceling','expired','refunded','revoked')
     or (p_phase in ('trial','paid','grace','canceling') and p_access_until is null)
  then
    raise exception 'invalid verified subscription fact' using errcode='22023';
  end if;

  -- Prevent two services racing to bind the same external purchase differently.
  -- Hash collision causes unnecessary serialization, not an ownership bypass.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_provider || ':' || p_environment || ':' || p_subscription_id, 0));

  select * into v_purchase
    from allin_private.v2_subscription_purchases
   where provider=p_provider and environment=p_environment
     and provider_subscription_id=p_subscription_id
   for update;

  -- Webhooks may update ONLY an already bound purchase. Creating the original
  -- owner association belongs to a distinct audited checkout/restore workflow
  -- that verifies both provider purchase and authenticated V2 account.
  if not found then
    raise exception 'subscription purchase is not prebound to an account'
      using errcode='42501';
  end if;
  if v_purchase.owner_id <> p_owner_id then
    raise exception 'verified purchase belongs to another owner'
      using errcode='42501';
  end if;

  -- Event ID cannot ever be reused across different subscriptions or phases.
  select purchase_id into v_event_purchase_id
    from allin_private.v2_subscription_verified_events
   where provider=p_provider and environment=p_environment
     and provider_event_id=p_event_id;
  if found then
    if v_event_purchase_id <> v_purchase.id then
      raise exception 'provider event identity collision' using errcode='23505';
    end if;
    return 'duplicate';
  end if;

  if p_revision <= v_purchase.revision then
    return 'stale';
  end if;

  insert into allin_private.v2_subscription_verified_events(
    purchase_id,provider,environment,provider_event_id,revision
  ) values (
    v_purchase.id,p_provider,p_environment,p_event_id,p_revision
  );

  update allin_private.v2_subscription_purchases
     set revision=p_revision, phase=p_phase,
         access_until=case when p_phase in ('trial','paid','grace','canceling')
                           then p_access_until else null end,
         last_provider_event_id=p_event_id, updated_at=now()
   where id=v_purchase.id;
  return 'applied';
end;
$$;
revoke all on function allin_private.v2_apply_verified_subscription_event(
  uuid,text,text,text,text,bigint,text,timestamptz
) from public, anon, authenticated;
-- Explicit service_role execute grant is a required independent release step,
-- NOT included here. Effective SQL role/current_user must be tested.

-- Critical acceptance remains outstanding: Auth subject existence, cross-owner
-- read/RLS, stale-event replay, event collision, concurrent bind/refund/renewal,
-- account deletion, two simultaneous subscriptions, installed-device states.
