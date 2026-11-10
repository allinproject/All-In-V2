-- ALL IN 365 V2: bind every authenticated mutation to the screen's expected identity.
-- Prevents a stale screen from writing to a newly active account if the Auth
-- session changes between the client-side getSession check and the RPC request.
-- V2 only. Preserve existing allowlists, version guards and idempotency semantics.

-- ---------------------------------------------------------------------------
-- Profile Settings: replace the old signature; do not leave an unsafe overload.
-- ---------------------------------------------------------------------------

drop function if exists public.v2_patch_profile_settings_section(text, jsonb, bigint, text);

create or replace function public.v2_patch_profile_settings_section(
  p_expected_user_id uuid,
  p_section text,
  p_patch jsonb,
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
  v_existing allin_private.v2_profile_settings_actions%rowtype;
  v_next_version bigint;
  v_allowed_sections constant text[] := array[
    'profile_preferences',
    'app_preferences',
    'training_preferences',
    'nutrition_preferences',
    'coach_preferences',
    'community_preferences',
    'privacy_preferences',
    'notification_preferences',
    'data_preferences'
  ];
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception 'Expected V2 account does not match the authenticated session'
      using errcode = '42501';
  end if;
  if p_section is null or not (p_section = any(v_allowed_sections)) then
    raise exception 'Unsupported profile settings section' using errcode = '22023';
  end if;
  if p_patch is null then
    raise exception 'Profile settings patch is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Profile settings patch must be a JSON object' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_each(p_patch)) then
    raise exception 'Profile settings patch must not be empty' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version <= 0 then
    raise exception 'Expected profile version is required' using errcode = '22023';
  end if;
  if p_client_action_id is null or length(btrim(p_client_action_id)) not between 1 and 160 then
    raise exception 'Client action ID is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select * into v_existing
  from allin_private.v2_profile_settings_actions a
  where a.user_id = v_user_id and a.client_action_id = p_client_action_id;

  if found then
    if v_existing.section <> p_section or v_existing.payload <> p_patch then
      raise exception 'Client action ID was reused with a different profile patch' using errcode = '22000';
    end if;
    return v_existing.result_version;
  end if;

  update public.v2_profile_settings s
  set settings = jsonb_set(
        s.settings,
        array[p_section],
        coalesce(s.settings -> p_section, '{}'::jsonb) || p_patch,
        true
      ),
      version = s.version + 1,
      updated_at = now()
  where s.user_id = v_user_id
    and s.version = p_expected_version
  returning s.version into v_next_version;

  if v_next_version is null then
    raise exception 'Profile settings changed; reload before retrying' using errcode = '40001';
  end if;

  insert into allin_private.v2_profile_settings_actions (
    user_id, client_action_id, section, payload, result_version
  ) values (
    v_user_id, p_client_action_id, p_section, p_patch, v_next_version
  );

  return v_next_version;
end;
$$;

revoke all on function public.v2_patch_profile_settings_section(uuid, text, jsonb, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.v2_patch_profile_settings_section(uuid, text, jsonb, bigint, text)
  to authenticated;

comment on function public.v2_patch_profile_settings_section(uuid, text, jsonb, bigint, text) is
  'Authenticated owner-only versioned settings patch. Expected user ID must equal auth.uid(); action retries are idempotent.';

-- ---------------------------------------------------------------------------
-- Legal acceptance: replace the old signature and bind receipt to expected ID.
-- ---------------------------------------------------------------------------

drop function if exists public.v2_accept_legal_documents(text, text, text, boolean, text);

create or replace function public.v2_accept_legal_documents(
  p_expected_user_id uuid,
  p_terms_version text,
  p_privacy_version text,
  p_founder_beta_terms_version text,
  p_age_18_confirmed boolean,
  p_client_action_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.v2_legal_acceptances%rowtype;
  v_acceptance_id uuid;
  v_now timestamptz := now();
  v_current_terms text;
  v_current_privacy text;
  v_current_founder_terms text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception 'Expected V2 account does not match the authenticated session'
      using errcode = '42501';
  end if;
  if p_age_18_confirmed is distinct from true then
    raise exception 'Age 18 confirmation is required' using errcode = '22023';
  end if;
  if p_client_action_id is null or length(btrim(p_client_action_id)) not between 1 and 160 then
    raise exception 'Client action ID is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select d.version into v_current_terms from public.v2_legal_documents d
  where d.document_key = 'terms' and d.status = 'published' and d.effective_at <= v_now
  order by d.effective_at desc, d.created_at desc limit 1;

  select d.version into v_current_privacy from public.v2_legal_documents d
  where d.document_key = 'privacy' and d.status = 'published' and d.effective_at <= v_now
  order by d.effective_at desc, d.created_at desc limit 1;

  select d.version into v_current_founder_terms from public.v2_legal_documents d
  where d.document_key = 'founder_beta_terms' and d.status = 'published' and d.effective_at <= v_now
  order by d.effective_at desc, d.created_at desc limit 1;

  if v_current_terms is null or v_current_privacy is null or v_current_founder_terms is null then
    raise exception 'Required V2 legal documents are not published' using errcode = '22023';
  end if;
  if p_terms_version is distinct from v_current_terms
    or p_privacy_version is distinct from v_current_privacy
    or p_founder_beta_terms_version is distinct from v_current_founder_terms then
    raise exception 'Legal document versions changed; reload and review the current versions' using errcode = '40001';
  end if;

  select * into v_existing from public.v2_legal_acceptances a
  where a.user_id = v_user_id and a.client_action_id = p_client_action_id;
  if found then
    if v_existing.terms_version <> p_terms_version
      or v_existing.privacy_version <> p_privacy_version
      or v_existing.founder_beta_terms_version <> p_founder_beta_terms_version
      or v_existing.age_18_confirmed <> p_age_18_confirmed then
      raise exception 'Client action ID was reused with a different legal acceptance' using errcode = '22000';
    end if;
    return v_existing.id;
  end if;

  insert into public.v2_legal_acceptances (
    user_id, terms_version, privacy_version, founder_beta_terms_version,
    age_18_confirmed, accepted_at, client_action_id
  ) values (
    v_user_id, p_terms_version, p_privacy_version, p_founder_beta_terms_version,
    true, v_now, p_client_action_id
  )
  returning id into v_acceptance_id;

  return v_acceptance_id;
end;
$$;

revoke all on function public.v2_accept_legal_documents(uuid, text, text, text, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.v2_accept_legal_documents(uuid, text, text, text, boolean, text)
  to authenticated;

comment on function public.v2_accept_legal_documents(uuid, text, text, text, boolean, text) is
  'Authenticated owner-only immutable legal receipt. Expected user ID must equal auth.uid(); exact published versions and age confirmation are required.';

-- ---------------------------------------------------------------------------
-- Onboarding: retain its private ledger and state machine with expected owner.
-- ---------------------------------------------------------------------------

drop function if exists public.v2_set_onboarding_step(text, text, bigint, text);

create or replace function public.v2_set_onboarding_step(
  p_expected_user_id uuid,
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
  if p_expected_user_id is null or p_expected_user_id is distinct from v_user_id then
    raise exception 'Expected V2 account does not match the authenticated session'
      using errcode = '42501';
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

  select coalesce(array_agg(s.step order by s.ordinality), '{}'::text[])
    into v_completed
  from unnest(v_allowed_steps) with ordinality as s(step, ordinality)
  where s.step = any(v_completed_work);

  select coalesce(array_agg(s.step order by s.ordinality), '{}'::text[])
    into v_skipped
  from unnest(v_allowed_steps) with ordinality as s(step, ordinality)
  where s.step = any(v_skipped_work);

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

revoke all on function public.v2_set_onboarding_step(uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.v2_set_onboarding_step(uuid, text, text, bigint, text)
  to authenticated;

comment on function public.v2_set_onboarding_step(uuid, text, text, bigint, text) is
  'Authenticated owner-only onboarding step mutation. Expected user ID must equal auth.uid(); supports complete, skip and reset with expected-version concurrency and exact action retry semantics.';

notify pgrst, 'reload schema';
