-- ALL IN 365 V2: guarded, idempotent onboarding progress writer.
-- V2 only. One step mutation per call; all writes remain owner-scoped.

create table if not exists allin_private.v2_onboarding_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_action_id text not null check (length(btrim(client_action_id)) between 1 and 160),
  step text not null check (step in (
    'focus',
    'training_pattern',
    'availability',
    'coach',
    'food_safety',
    'proactivity'
  )),
  action text not null check (action in ('complete', 'skip', 'reset')),
  result_version bigint not null check (result_version > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, client_action_id)
);

alter table allin_private.v2_onboarding_actions enable row level security;
revoke all on allin_private.v2_onboarding_actions from public, anon, authenticated, service_role;

create or replace function public.v2_set_onboarding_step(
  p_step text,
  p_action text,
  p_expected_version bigint,
  p_client_action_id text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_action_id text := nullif(btrim(p_client_action_id), '');
  v_existing allin_private.v2_onboarding_actions%rowtype;
  v_progress public.v2_onboarding_progress%rowtype;
  v_allowed_steps constant text[] := array[
    'focus',
    'training_pattern',
    'availability',
    'coach',
    'food_safety',
    'proactivity'
  ];
  v_completed_work text[];
  v_skipped_work text[];
  v_completed text[];
  v_skipped text[];
  v_result_version bigint;
  v_is_complete boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_step is null or not (p_step = any(v_allowed_steps)) then
    raise exception 'Unsupported V2 onboarding step' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('complete', 'skip', 'reset') then
    raise exception 'Unsupported V2 onboarding action' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'Expected onboarding version is required' using errcode = '22023';
  end if;
  if v_action_id is null or length(v_action_id) not between 1 and 160 then
    raise exception 'Client action ID is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  -- Exact retry lookup precedes the version check so a lost response can be
  -- retried safely even after a later onboarding step has advanced the row.
  select * into v_existing
  from allin_private.v2_onboarding_actions a
  where a.user_id = v_user_id
    and a.client_action_id = v_action_id;

  if found then
    if v_existing.step <> p_step or v_existing.action <> p_action then
      raise exception 'Client action ID was reused with a different onboarding mutation'
        using errcode = '22000';
    end if;
    return v_existing.result_version;
  end if;

  select * into v_progress
  from public.v2_onboarding_progress o
  where o.user_id = v_user_id
  for update;

  if not found then
    raise exception 'V2 onboarding progress is not initialized for this account'
      using errcode = '55000';
  end if;
  if v_progress.version <> p_expected_version then
    raise exception 'V2 onboarding progress changed; reload before retrying'
      using errcode = '40001';
  end if;

  v_completed_work := v_progress.completed_steps;
  v_skipped_work := v_progress.skipped_steps;

  if p_action = 'complete' then
    v_completed_work := array_append(array_remove(v_completed_work, p_step), p_step);
    v_skipped_work := array_remove(v_skipped_work, p_step);
  elsif p_action = 'skip' then
    v_skipped_work := array_append(array_remove(v_skipped_work, p_step), p_step);
    v_completed_work := array_remove(v_completed_work, p_step);
  else
    v_completed_work := array_remove(v_completed_work, p_step);
    v_skipped_work := array_remove(v_skipped_work, p_step);
  end if;

  -- Store both arrays in the canonical onboarding sequence order.
  select coalesce(array_agg(s.step order by s.ordinality), '{}'::text[])
    into v_completed
  from unnest(v_allowed_steps) with ordinality as s(step, ordinality)
  where s.step = any(v_completed_work);

  select coalesce(array_agg(s.step order by s.ordinality), '{}'::text[])
    into v_skipped
  from unnest(v_allowed_steps) with ordinality as s(step, ordinality)
  where s.step = any(v_skipped_work);

  -- Repeating the same state under a new action ID is a no-op: record the
  -- action for future retry, but do not bump the aggregate version.
  if v_completed = v_progress.completed_steps
     and v_skipped = v_progress.skipped_steps then
    v_result_version := v_progress.version;
  else
    v_is_complete := cardinality(v_completed) + cardinality(v_skipped)
      = cardinality(v_allowed_steps);

    update public.v2_onboarding_progress o
    set completed_steps = v_completed,
        skipped_steps = v_skipped,
        version = o.version + 1,
        completed_at = case
          when v_is_complete then coalesce(o.completed_at, now())
          else null
        end
    where o.user_id = v_user_id
      and o.version = p_expected_version
    returning o.version into v_result_version;

    if v_result_version is null then
      raise exception 'V2 onboarding progress changed; reload before retrying'
        using errcode = '40001';
    end if;
  end if;

  insert into allin_private.v2_onboarding_actions (
    user_id, client_action_id, step, action, result_version
  ) values (
    v_user_id, v_action_id, p_step, p_action, v_result_version
  );

  return v_result_version;
end;
$$;

revoke all on function public.v2_set_onboarding_step(text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.v2_set_onboarding_step(text, text, bigint, text)
  to authenticated;

comment on table allin_private.v2_onboarding_actions is
  'Private per-user idempotency ledger for the V2 onboarding progress writer; no API role has direct access.';
comment on function public.v2_set_onboarding_step(text, text, bigint, text) is
  'Authenticated owner-only onboarding step mutation. Supports complete, skip and reset with expected-version concurrency and exact action retry semantics.';
