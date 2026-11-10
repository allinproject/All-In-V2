-- Rollback-only security, batch-bound and expiry behavior test for the provider-cache purge RPC.
begin;

insert into allin_private.v2_provider_cache (
  provider, cache_key, payload, source_quality, source_license, fetched_at, expires_at
) values
  ('usda_fdc_generic_search', 'all227-expired-probe', '{"probe":"expired"}'::jsonb,
   'probe', 'probe', now() - interval '2 hours', now() - interval '1 hour'),
  ('usda_fdc_generic_search', 'all227-fresh-probe', '{"probe":"fresh"}'::jsonb,
   'probe', 'probe', now(), now() + interval '1 hour')
on conflict (provider, cache_key) do update
set payload = excluded.payload,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.v2_provider_cache_prune_expired(10);
    raise exception 'authenticated role unexpectedly pruned provider cache';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
  v_deleted integer;
begin
  begin
    perform public.v2_provider_cache_prune_expired(0);
    raise exception 'zero batch size unexpectedly accepted';
  exception when sqlstate '22023' then
    null;
  end;

  v_deleted := public.v2_provider_cache_prune_expired(10);
  if v_deleted <> 1 then
    raise exception 'expected one expired row deleted, got %', v_deleted;
  end if;

end;
$;
reset role;

-- Verify table state as the migration owner; service_role intentionally has no direct table grants.
do $
begin
  if exists (
    select 1 from allin_private.v2_provider_cache
    where provider = 'usda_fdc_generic_search'
      and cache_key = 'all227-expired-probe'
  ) then
    raise exception 'expired provider cache probe row still exists';
  end if;

  if not exists (
    select 1 from allin_private.v2_provider_cache
    where provider = 'usda_fdc_generic_search'
      and cache_key = 'all227-fresh-probe'
      and expires_at > now()
  ) then
    raise exception 'fresh provider cache probe row was incorrectly removed';
  end if;
end;
$;
rollback;
