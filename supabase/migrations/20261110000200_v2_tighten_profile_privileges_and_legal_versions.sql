-- ALL IN 365 V2: tighten profile privileges and legal version handling.
-- V2 only. No V1 objects are modified.

revoke update on table public.v2_profiles from authenticated;
grant update (display_name, avatar_path) on table public.v2_profiles to authenticated;

create or replace function public.v2_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.v2_set_updated_at() from public, anon, authenticated;

drop trigger if exists v2_profiles_set_updated_at on public.v2_profiles;
create trigger v2_profiles_set_updated_at before update on public.v2_profiles
for each row execute function public.v2_set_updated_at();

drop trigger if exists v2_profile_settings_set_updated_at on public.v2_profile_settings;
create trigger v2_profile_settings_set_updated_at before update on public.v2_profile_settings
for each row execute function public.v2_set_updated_at();

drop trigger if exists v2_onboarding_set_updated_at on public.v2_onboarding_progress;
create trigger v2_onboarding_set_updated_at before update on public.v2_onboarding_progress
for each row execute function public.v2_set_updated_at();

create or replace function public.v2_prevent_published_legal_content_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' and (
    new.document_key is distinct from old.document_key
    or new.version is distinct from old.version
    or new.title is distinct from old.title
    or new.content_markdown is distinct from old.content_markdown
    or new.content_sha256 is distinct from old.content_sha256
    or new.effective_at is distinct from old.effective_at
  ) then
    raise exception 'Published V2 legal document content is immutable; insert a new version instead'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.v2_prevent_published_legal_content_change() from public, anon, authenticated;

drop trigger if exists v2_legal_documents_immutable_after_publish on public.v2_legal_documents;
create trigger v2_legal_documents_immutable_after_publish
before update on public.v2_legal_documents
for each row execute function public.v2_prevent_published_legal_content_change();

create or replace function public.v2_my_profile_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile jsonb;
  v_settings jsonb;
  v_onboarding jsonb;
  v_legal_documents jsonb;
  v_legal_acceptance jsonb;
begin
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
$$;

revoke all on function public.v2_my_profile_state() from public, anon;
grant execute on function public.v2_my_profile_state() to authenticated;

create or replace function public.v2_accept_legal_documents(
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
  ) returning id into v_acceptance_id;

  return v_acceptance_id;
end;
$$;

revoke all on function public.v2_accept_legal_documents(text, text, text, boolean, text) from public, anon;
grant execute on function public.v2_accept_legal_documents(text, text, text, boolean, text) to authenticated;
