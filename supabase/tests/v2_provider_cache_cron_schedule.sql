-- Verify Cron scheduling and cache-purge execution boundaries in V2.
do $cron_test$
declare
  v_job record;
begin
  select jobid, jobname, schedule, command, username, active
    into v_job
  from cron.job
  where jobname = 'allin-v2-provider-cache-expired-purge';

  if not found then
    raise exception 'provider cache purge job was not scheduled';
  end if;

  if v_job.username <> 'postgres' then
    raise exception 'purge job owner must be postgres, got %', v_job.username;
  end if;

  if v_job.schedule <> '17 * * * *' then
    raise exception 'unexpected purge schedule: %', v_job.schedule;
  end if;

  if v_job.command <> 'select allin_private.v2_provider_cache_prune_expired(5000);' then
    raise exception 'unexpected purge command: %', v_job.command;
  end if;

  if not v_job.active then
    raise exception 'provider purge job must be active';
  end if;

  if not has_schema_privilege('postgres', 'cron', 'USAGE') then
    raise exception 'postgres is missing cron schema usage';
  end if;

  if has_schema_privilege('authenticated', 'cron', 'USAGE')
     or has_schema_privilege('anon', 'cron', 'USAGE')
     or has_schema_privilege('service_role', 'cron', 'USAGE') then
    raise exception 'unexpected non-owner access to cron schema';
  end if;

  if has_function_privilege('service_role', 'allin_private.v2_provider_cache_prune_expired(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'allin_private.v2_provider_cache_prune_expired(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'allin_private.v2_provider_cache_prune_expired(integer)', 'EXECUTE') then
    raise exception 'private purge helper must remain owner-only';
  end if;

  if not has_function_privilege('service_role', 'public.v2_provider_cache_prune_expired(integer)', 'EXECUTE') then
    raise exception 'service_role must retain the public cache purge wrapper';
  end if;

  if has_function_privilege('authenticated', 'public.v2_provider_cache_prune_expired(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.v2_provider_cache_prune_expired(integer)', 'EXECUTE') then
    raise exception 'public purge wrapper must remain unavailable to anon/authenticated';
  end if;
end;
$cron_test$;

-- As postgres (the job owner), the exact private command used by pg_cron is executable.
select allin_private.v2_provider_cache_prune_expired(5000) as postgres_owner_pruned_rows;
