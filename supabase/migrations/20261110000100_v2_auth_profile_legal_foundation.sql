-- ALL IN 365 V2: Auth/Profile/Legal foundation
-- New V2 backend only. Do not apply to V1.
-- No V1 user or personal data is imported by this migration.

create schema if not exists allin_private;

-- Fail closed for future objects created by the postgres migration role.
-- Each later migration must grant only the privileges its own API surface needs.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from public, anon, authenticated, service_role;
revoke all on schema allin_private from public, anon, authenticated;
grant usage on schema allin_private to postgres, service_role;

create table if not exists public.v2_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v2_profile_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.v2_onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_steps text[] not null default '{}'::text[],
  skipped_steps text[] not null default '{}'::text[],
  version bigint not null default 1 check (version > 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint v2_onboarding_steps_valid check (
    completed_steps <@ array['focus','training_pattern','availability','coach','food_safety','proactivity']::text[]
    and skipped_steps <@ array['focus','training_pattern','availability','coach','food_safety','proactivity']::text[]
    and not (completed_steps && skipped_steps)
  )
);

create table if not exists public.v2_legal_documents (
  document_key text not null check (document_key in ('terms','privacy','founder_beta_terms')),
  version text not null check (length(btrim(version)) between 1 and 120),
  title text not null check (length(btrim(title)) between 1 and 200),
  content_markdown text not null check (length(btrim(content_markdown)) > 0),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_key, version),
  constraint v2_published_legal_has_effective_date check (status <> 'published' or effective_at is not null)
);

create index if not exists v2_legal_documents_published_idx
  on public.v2_legal_documents (document_key, effective_at desc)
  where status = 'published';

create table if not exists public.v2_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  founder_beta_terms_version text not null,
  age_18_confirmed boolean not null check (age_18_confirmed),
  accepted_at timestamptz not null default now(),
  client_action_id text not null check (length(btrim(client_action_id)) between 1 and 160),
  unique (user_id, client_action_id)
  -- Exact document_key/version publication checks are enforced by
  -- v2_accept_legal_documents because each FK has a fixed document_key.
);

create index if not exists v2_legal_acceptances_user_accepted_idx
  on public.v2_legal_acceptances (user_id, accepted_at desc);

create table if not exists allin_private.v2_profile_settings_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_action_id text not null,
  section text not null,
  payload jsonb not null,
  result_version bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, client_action_id)
);

revoke all on allin_private.v2_profile_settings_actions from public, anon, authenticated, service_role;

create or replace function public.v2_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.v2_profiles (user_id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (user_id) do nothing;

  insert into public.v2_profile_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.v2_onboarding_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.v2_handle_new_user() from public, anon, authenticated;

drop trigger if exists v2_on_auth_user_created on auth.users;
create trigger v2_on_auth_user_created
after insert on auth.users
for each row execute function public.v2_handle_new_user();

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

  select to_jsonb(p) into v_profile
  from public.v2_profiles p
  where p.user_id = v_user_id;

  select jsonb_build_object('version', s.version, 'settings', s.settings, 'updated_at', s.updated_at)
    into v_settings
  from public.v2_profile_settings s
  where s.user_id = v_user_id;

  select jsonb_build_object(
    'version', o.version,
    'completed_steps', o.completed_steps,
    'skipped_steps', o.skipped_steps,
    'completed_at', o.completed_at,
    'updated_at', o.updated_at
  ) into v_onboarding
  from public.v2_onboarding_progress o
  where o.user_id = v_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_key', d.document_key,
    'version', d.version,
    'title', d.title,
    'content_markdown', d.content_markdown,
    'content_sha256', d.content_sha256,
    'effective_at', d.effective_at
  ) order by d.document_key), '[]'::jsonb)
  into v_legal_documents
  from public.v2_legal_documents d
  where d.status = 'published'
    and d.effective_at <= now();

  select to_jsonb(a) into v_legal_acceptance
  from public.v2_legal_acceptances a
  where a.user_id = v_user_id
  order by a.accepted_at desc
  limit 1;

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

create or replace function public.v2_patch_profile_settings_section(
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

revoke all on function public.v2_patch_profile_settings_section(text, jsonb, bigint, text) from public, anon;
grant execute on function public.v2_patch_profile_settings_section(text, jsonb, bigint, text) to authenticated;

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

  select * into v_existing
  from public.v2_legal_acceptances a
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

  if not exists (
    select 1 from public.v2_legal_documents d
    where d.document_key = 'terms' and d.version = p_terms_version
      and d.status = 'published' and d.effective_at <= v_now
  ) or not exists (
    select 1 from public.v2_legal_documents d
    where d.document_key = 'privacy' and d.version = p_privacy_version
      and d.status = 'published' and d.effective_at <= v_now
  ) or not exists (
    select 1 from public.v2_legal_documents d
    where d.document_key = 'founder_beta_terms' and d.version = p_founder_beta_terms_version
      and d.status = 'published' and d.effective_at <= v_now
  ) then
    raise exception 'Required V2 legal documents are not published or versions do not match' using errcode = '22023';
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

revoke all on function public.v2_accept_legal_documents(text, text, text, boolean, text) from public, anon;
grant execute on function public.v2_accept_legal_documents(text, text, text, boolean, text) to authenticated;

alter table public.v2_profiles enable row level security;
alter table public.v2_profile_settings enable row level security;
alter table public.v2_onboarding_progress enable row level security;
alter table public.v2_legal_documents enable row level security;
alter table public.v2_legal_acceptances enable row level security;

drop policy if exists v2_profiles_owner_read on public.v2_profiles;
create policy v2_profiles_owner_read on public.v2_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists v2_profiles_owner_update on public.v2_profiles;
create policy v2_profiles_owner_update on public.v2_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists v2_profile_settings_owner_read on public.v2_profile_settings;
create policy v2_profile_settings_owner_read on public.v2_profile_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists v2_onboarding_owner_read on public.v2_onboarding_progress;
create policy v2_onboarding_owner_read on public.v2_onboarding_progress
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists v2_legal_documents_published_read on public.v2_legal_documents;
create policy v2_legal_documents_published_read on public.v2_legal_documents
  for select to anon, authenticated
  using (status = 'published' and effective_at <= now());

drop policy if exists v2_legal_acceptances_owner_read on public.v2_legal_acceptances;
create policy v2_legal_acceptances_owner_read on public.v2_legal_acceptances
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.v2_profiles from public, anon, authenticated;
revoke all on public.v2_profile_settings from public, anon, authenticated;
revoke all on public.v2_onboarding_progress from public, anon, authenticated;
revoke all on public.v2_legal_documents from public, anon, authenticated;
revoke all on public.v2_legal_acceptances from public, anon, authenticated;

grant select, update on public.v2_profiles to authenticated;
grant select on public.v2_profile_settings to authenticated;
grant select on public.v2_onboarding_progress to authenticated;
grant select on public.v2_legal_documents to anon, authenticated;
grant select on public.v2_legal_acceptances to authenticated;

comment on table public.v2_profiles is 'V2 owner-scoped user profile. One row is created automatically for each V2 Auth user.';
comment on table public.v2_profile_settings is 'V2 owner-scoped settings; mutations must use v2_patch_profile_settings_section with expected-version and idempotency.';
comment on table public.v2_onboarding_progress is 'V2 owner-scoped onboarding progress; writes are server-owned and versioned.';
comment on table public.v2_legal_documents is 'V2 legal document versions. Only reviewed/published versions are exposed publicly; no legal version is published by this foundation migration.';
comment on table public.v2_legal_acceptances is 'Immutable V2 legal acceptance receipts tied to exact published versions and authenticated owner.';
