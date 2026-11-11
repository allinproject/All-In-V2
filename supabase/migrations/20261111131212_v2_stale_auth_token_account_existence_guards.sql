-- ALL-251: deny stale JWT RPC use after the Auth account is deleted.
-- Preserve each existing V2 owning function, adding only an Auth user-existence check.

CREATE OR REPLACE FUNCTION public.v2_accept_legal_documents(p_expected_user_id uuid, p_terms_version text, p_privacy_version text, p_founder_beta_terms_version text, p_age_18_confirmed boolean, p_client_action_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.v2_legal_acceptances%rowtype;
  v_acceptance_id uuid;
  v_now timestamptz := now();
  v_current_terms text;
  v_current_privacy text;
  v_current_founder_terms text;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.v2_cancel_account_deletion_request(p_expected_user_id uuid, p_expected_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_account_deletion_requests%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Account deletion request requires the active user' using errcode='42501';
 end if;
 if p_expected_request_id is null then
  raise exception 'Expected deletion request identifier required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2-delete-request:'||v_user::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user for update;
 if not found or v_row.request_id is distinct from p_expected_request_id then
  raise exception 'Deletion request changed; reload status' using errcode='40001';
 end if;
 if v_row.status='requested' then
   update allin_private.v2_account_deletion_requests
   set status='cancelled',resolved_at=now(),updated_at=now()
   where user_id=v_user and request_id=p_expected_request_id and status='requested'
   returning * into v_row;
 elsif v_row.status<>'cancelled' then
   raise exception 'Deletion has progressed and cannot be cancelled here' using errcode='42501';
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

CREATE OR REPLACE FUNCTION public.v2_my_account_deletion_request(p_expected_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_account_deletion_requests%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Account deletion request requires the active user' using errcode='42501';
 end if;
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user;
 if not found then
  return jsonb_build_object('status','none');
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

CREATE OR REPLACE FUNCTION public.v2_my_health_considerations(p_expected_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_health_considerations%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Health records require the active account' using errcode='42501';
 end if;
 select * into v_row from allin_private.v2_health_considerations where user_id=v_user;
 if not found then return jsonb_build_object('conditions','[]'::jsonb,'limitations','[]'::jsonb,'coach_opt_in',false,'version',0); end if;
 return jsonb_build_object('conditions',v_row.conditions,'limitations',v_row.limitations,
  'coach_opt_in',v_row.coach_opt_in,'version',v_row.version);
end;$function$;

CREATE OR REPLACE FUNCTION public.v2_my_profile_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile jsonb;
  v_settings jsonb;
  v_onboarding jsonb;
  v_legal_documents jsonb;
  v_legal_acceptance jsonb;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select to_jsonb(p) into v_profile from public.v2_profiles p where p.user_id = v_user_id;
  select jsonb_build_object('version', s.version, 'settings', s.settings, 'updated_at', s.updated_at)
    into v_settings from public.v2_profile_settings s where s.user_id = v_user_id;
  select jsonb_build_object(
    'version', o.version, 'completed_steps', o.completed_steps,
    'skipped_steps', o.skipped_steps, 'completed_at', o.completed_at, 'updated_at', o.updated_at
  ) into v_onboarding from public.v2_onboarding_progress o where o.user_id = v_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_key', latest.document_key, 'version', latest.version, 'title', latest.title,
    'content_markdown', latest.content_markdown, 'content_sha256', latest.content_sha256,
    'effective_at', latest.effective_at
  ) order by latest.document_key), '[]'::jsonb)
  into v_legal_documents
  from (
    select distinct on (d.document_key)
      d.document_key, d.version, d.title, d.content_markdown, d.content_sha256, d.effective_at
    from public.v2_legal_documents d
    where d.status = 'published' and d.effective_at <= now()
    order by d.document_key, d.effective_at desc, d.created_at desc
  ) latest;

  select to_jsonb(a) into v_legal_acceptance from public.v2_legal_acceptances a
  where a.user_id = v_user_id order by a.accepted_at desc limit 1;

  return jsonb_build_object(
    'profile', coalesce(v_profile, '{}'::jsonb),
    'settings', coalesce(v_settings, '{}'::jsonb),
    'onboarding', coalesce(v_onboarding, '{}'::jsonb),
    'required_legal_documents', v_legal_documents,
    'latest_legal_acceptance', v_legal_acceptance
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.v2_patch_profile_settings_section(p_expected_user_id uuid, p_section text, p_patch jsonb, p_expected_version bigint, p_client_action_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.v2_request_account_deletion(p_expected_user_id uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_account_deletion_requests%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Account deletion request requires the active user' using errcode='42501';
 end if;
 if p_confirm is distinct from 'DELETE MY ACCOUNT' then
  raise exception 'Explicit deletion request confirmation required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2-delete-request:'||v_user::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user for update;
 if not found then
   insert into allin_private.v2_account_deletion_requests(user_id) values(v_user)
    returning * into v_row;
 elsif v_row.status in ('rejected','cancelled') then
   update allin_private.v2_account_deletion_requests
   set status='requested', requested_at=now(), updated_at=now(), resolved_at=null,
       request_id=gen_random_uuid()
   where user_id=v_user returning * into v_row;
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

CREATE OR REPLACE FUNCTION public.v2_save_health_considerations(p_expected_user_id uuid, p_conditions jsonb, p_limitations jsonb, p_coach_opt_in boolean, p_expected_version bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_health_considerations%rowtype;
 v_next bigint;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Health records require the active account' using errcode='42501';
 end if;
 if p_expected_version is null or p_expected_version < 0 then
  raise exception 'Expected health record version required' using errcode='22023';
 end if;
 if p_coach_opt_in is null then
  raise exception 'Coach consent must be explicit' using errcode='22023';
 end if;
 if p_conditions is null or p_limitations is null
   or jsonb_typeof(p_conditions)<>'array' or jsonb_typeof(p_limitations)<>'array'
   or jsonb_array_length(p_conditions)>12 or jsonb_array_length(p_limitations)>12 then
  raise exception 'Invalid health record arrays' using errcode='22023';
 end if;
 if exists (
  select 1 from jsonb_array_elements(p_conditions) as item(value)
  where jsonb_typeof(item.value)<>'string'
  or length(btrim(item.value #>> '{}')) not between 1 and 180
 ) or exists (
  select 1 from jsonb_array_elements(p_limitations) as item(value)
  where jsonb_typeof(item.value)<>'string'
  or length(btrim(item.value #>> '{}')) not between 1 and 180
 ) then raise exception 'Invalid health record text' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('v2-health:'||v_user::text,0));
 select * into v_row from allin_private.v2_health_considerations where user_id=v_user for update;
 if not found then
  if p_expected_version<>0 then
   raise exception 'Health record changed; reload before retrying' using errcode='40001';
  end if;
  insert into allin_private.v2_health_considerations
   (user_id,conditions,limitations,coach_opt_in)
  values (v_user,p_conditions,p_limitations,p_coach_opt_in)
  returning version into v_next;
 else
  if v_row.version<>p_expected_version then
   raise exception 'Health record changed; reload before retrying' using errcode='40001';
  end if;
  update allin_private.v2_health_considerations
   set conditions=p_conditions,limitations=p_limitations,coach_opt_in=p_coach_opt_in,
   version=version+1,updated_at=now()
   where user_id=v_user returning version into v_next;
 end if;
 return v_next;
end;$function$;

CREATE OR REPLACE FUNCTION public.v2_set_onboarding_step(p_expected_user_id uuid, p_step text, p_action text, p_expected_version bigint, p_client_action_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
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
$function$;
