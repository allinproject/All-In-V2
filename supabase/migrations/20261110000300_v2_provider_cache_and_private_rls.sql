-- ALL IN 365 V2: private provider cache and private-table RLS hardening.
-- Apply only to the V2 project. No V1 objects are modified.

-- Clear the existing private-ledger advisory as defense in depth.
alter table allin_private.v2_profile_settings_actions enable row level security;
-- Intentionally no anon/authenticated/service_role table policies or grants.
-- The settings RPC executes as the owning migration role and remains the only writer.

create table if not exists allin_private.v2_provider_cache (
  provider text not null check (provider in (
    'usda_fdc_generic_search',
    'usda_fdc_food_detail',
    'usda_fdc_branded_gtin',
    'open_food_facts_gtin',
    'open_food_facts_search'
  )),
  cache_key text not null check (length(btrim(cache_key)) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) in ('object','array')),
  source_quality text,
  source_license text,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, cache_key),
  constraint v2_provider_cache_expiry_after_fetch check (expires_at > fetched_at),
  constraint v2_provider_cache_payload_size check (octet_length(payload::text) <= 524288)
);

create index if not exists v2_provider_cache_expires_at_idx
  on allin_private.v2_provider_cache (expires_at);

alter table allin_private.v2_provider_cache enable row level security;

revoke all on allin_private.v2_provider_cache from public, anon, authenticated, service_role;

create or replace function public.v2_provider_cache_get(
  p_provider text,
  p_cache_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row allin_private.v2_provider_cache%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_provider is null or p_cache_key is null
     or length(btrim(p_cache_key)) not between 1 and 200 then
    raise exception 'Valid provider and cache key are required' using errcode = '22023';
  end if;

  select * into v_row
  from allin_private.v2_provider_cache c
  where c.provider = p_provider
    and c.cache_key = p_cache_key
    and c.expires_at > now();

  if not found then return null; end if;

  return jsonb_build_object(
    'payload', v_row.payload,
    'source_quality', v_row.source_quality,
    'source_license', v_row.source_license,
    'fetched_at', v_row.fetched_at,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.v2_provider_cache_put(
  p_provider text,
  p_cache_key text,
  p_payload jsonb,
  p_source_quality text,
  p_source_license text,
  p_fetched_at timestamptz,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_provider not in (
    'usda_fdc_generic_search',
    'usda_fdc_food_detail',
    'usda_fdc_branded_gtin',
    'open_food_facts_gtin',
    'open_food_facts_search'
  ) then
    raise exception 'Unsupported provider cache namespace' using errcode = '22023';
  end if;
  if p_cache_key is null or length(btrim(p_cache_key)) not between 1 and 200 then
    raise exception 'Provider cache key is invalid' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) not in ('object','array')
     or octet_length(p_payload::text) > 524288 then
    raise exception 'Provider cache payload must be an object or array no larger than 512 KiB' using errcode = '22023';
  end if;
  if p_fetched_at is null or p_fetched_at > now() + interval '1 day'
     or p_expires_at is null or p_expires_at <= p_fetched_at
     or p_expires_at > now() + interval '30 days' then
    raise exception 'Provider cache timestamps or TTL are invalid' using errcode = '22023';
  end if;

  insert into allin_private.v2_provider_cache (
    provider, cache_key, payload, source_quality, source_license, fetched_at, expires_at, updated_at
  ) values (
    p_provider, p_cache_key, p_payload, p_source_quality, p_source_license, p_fetched_at, p_expires_at, now()
  )
  on conflict (provider, cache_key) do update
  set payload = excluded.payload,
      source_quality = excluded.source_quality,
      source_license = excluded.source_license,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      updated_at = now();

  return true;
end;
$$;

revoke all on function public.v2_provider_cache_get(text,text) from public, anon, authenticated, service_role;
revoke all on function public.v2_provider_cache_put(text,text,jsonb,text,text,timestamptz,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.v2_provider_cache_get(text,text) to service_role;
grant execute on function public.v2_provider_cache_put(text,text,jsonb,text,text,timestamptz,timestamptz) to service_role;

comment on table allin_private.v2_provider_cache is
  'V2-only server-side cache for public USDA/OFF provider responses. No user-specific recipe/profile data. Private RLS enabled; cache RPCs are service_role-only.';
comment on function public.v2_provider_cache_get(text,text) is
  'Service-role-only lookup of a non-expired V2 public provider response and its source/license/freshness provenance.';
comment on function public.v2_provider_cache_put(text,text,jsonb,text,text,timestamptz,timestamptz) is
  'Service-role-only upsert of bounded public provider response cache with source/license/fetched/expiry provenance.';
