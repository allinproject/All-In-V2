-- ALL IN 365 V2: bounded cleanup for expired public provider-response cache entries.
-- The RPC is service-role-only. Scheduling remains a separate approved operations concern.

create or replace function public.v2_provider_cache_prune_expired(
  p_batch_size integer default 500
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'Batch size must be between 1 and 5000' using errcode = '22023';
  end if;

  with expired_rows as materialized (
    select c.provider, c.cache_key
    from allin_private.v2_provider_cache c
    where c.expires_at <= statement_timestamp()
    order by c.expires_at, c.provider, c.cache_key
    limit p_batch_size
    for update skip locked
  )
  delete from allin_private.v2_provider_cache c
  using expired_rows e
  where c.provider = e.provider
    and c.cache_key = e.cache_key;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.v2_provider_cache_prune_expired(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.v2_provider_cache_prune_expired(integer)
  to service_role;

comment on function public.v2_provider_cache_prune_expired(integer) is
  'Service-role-only bounded deletion of expired V2 public provider-response cache rows. Does not schedule itself; call from an approved maintenance scheduler.';
