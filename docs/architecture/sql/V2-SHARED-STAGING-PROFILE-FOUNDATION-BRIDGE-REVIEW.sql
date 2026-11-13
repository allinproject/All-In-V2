-- ALL-222/243/246/251: REVIEW ONLY, isolated staging foundation bridge.
-- Source migration bytes are copied exactly from canonical foundation M1/M2
-- to add the SAME profile, settings, legal, and Auth trigger owner system.
-- This SQL is NOT yet authorized for hosted staging or production release.
-- Guarded for EXISTING shared staging and preserves ALL-251/217/228/225.
BEGIN;
DO $bridge_gate$
BEGIN
 IF pg_catalog.to_regclass('public.v2_profiles') IS NOT NULL
 OR pg_catalog.to_regclass('public.v2_profile_settings') IS NOT NULL
 OR pg_catalog.to_regclass('public.v2_onboarding_progress') IS NOT NULL
 OR pg_catalog.to_regclass('public.v2_legal_documents') IS NOT NULL
 OR pg_catalog.to_regclass('public.v2_legal_acceptances') IS NOT NULL
 THEN RAISE EXCEPTION 'Canonical profile foundation already present; do not replay bridge'
  USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_account_export_requests_candidate') IS NULL
 OR pg_catalog.to_regclass('public.v2_coach_threads') IS NULL
 OR pg_catalog.to_regclass('public.v2_coach_messages') IS NULL
 OR pg_catalog.to_regclass('public.v2_food_log_entries') IS NULL
 OR pg_catalog.to_regclass('public.v2_ingredients') IS NULL
 THEN RAISE EXCEPTION 'Shared staging Coach/Nutrition/account lifecycle context missing'
  USING ERRCODE='42501'; END IF;
 IF EXISTS (
 SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','allin_private') AND c.relkind='r'
 AND (c.relname LIKE 'v2_coach_%' OR c.relname LIKE 'v2_food_log_%'
 OR c.relname LIKE 'v2_ingredient_%' OR c.relname LIKE 'v2_account_%')
 AND NOT c.relrowsecurity
 ) THEN RAISE EXCEPTION 'Existing shared staging table without RLS'
 USING ERRCODE='42501'; END IF;
END $bridge_gate$;
-- Snapshot definitions, ACL, RLS, and rows for all previously installed V2 tables.
CREATE TEMP TABLE v2_bridge_existing_table_fingerprints ON COMMIT DROP AS
SELECT n.nspname||'.'||c.relname AS identity,
       pg_catalog.md5(pg_catalog.concat_ws('|',
        c.relrowsecurity::text,coalesce(c.relacl::text,''),
        coalesce((SELECT pg_catalog.string_agg(a.attname||':'||a.atttypid::text||
                 ':'||a.attnotnull::text,',' ORDER BY a.attnum)
          FROM pg_catalog.pg_attribute a
          WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),''),
        coalesce((SELECT pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(k.oid),
                   ';' ORDER BY k.conname)
          FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),'')
       )) AS fingerprint,
       -- Exact existing row count is checked separately by test fixtures.
       c.oid
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','allin_private') AND c.relkind='r'
 AND c.relname LIKE 'v2_%';
CREATE TEMP TABLE v2_bridge_existing_function_fingerprints ON COMMIT DROP AS
SELECT n.nspname||'.'||p.proname||'('||
 pg_catalog.pg_get_function_identity_arguments(p.oid)||')' AS identity,
 pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')) AS fingerprint
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','allin_private') AND p.proname LIKE 'v2_%';

-- BEGIN CANONICAL SOURCE supabase/migrations/20261110021548_v2_auth_profile_legal_foundation.sql [Git blob 717ee71a9cab7402424122999bfde913bde0c61a]
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

-- END CANONICAL SOURCE supabase/migrations/20261110021548_v2_auth_profile_legal_foundation.sql

-- BEGIN CANONICAL SOURCE supabase/migrations/20261110022457_v2_tighten_profile_privileges_and_legal_versions.sql [Git blob f90db2e6ebc8fc9aff5e9b692ddd3151341d83ae]
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

-- END CANONICAL SOURCE supabase/migrations/20261110022457_v2_tighten_profile_privileges_and_legal_versions.sql

-- Do not silently alter any original Coach/Nutrition/account-lifecycle
-- table definition, ACL, RLS, or function while installing canonical owners.
DO $bridge_post$
DECLARE v_changed text;
BEGIN
 SELECT pg_catalog.string_agg(x.identity,', ' ORDER BY x.identity)
 INTO v_changed
 FROM (
  (SELECT identity,fingerprint FROM v2_bridge_existing_table_fingerprints
    EXCEPT
   SELECT n.nspname||'.'||c.relname,
    pg_catalog.md5(pg_catalog.concat_ws('|',
     c.relrowsecurity::text,coalesce(c.relacl::text,''),
     coalesce((SELECT pg_catalog.string_agg(a.attname||':'||a.atttypid::text||
      ':'||a.attnotnull::text,',' ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid
       AND a.attnum>0 AND NOT a.attisdropped),''),
     coalesce((SELECT pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(k.oid),
      ';' ORDER BY k.conname)
      FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),'')
     ))
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','allin_private') AND c.relkind='r'
    AND c.relname LIKE 'v2_%')
  UNION
  (SELECT identity,fingerprint FROM v2_bridge_existing_function_fingerprints
   EXCEPT
   SELECT n.nspname||'.'||p.proname||'('||
    pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''))
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','allin_private') AND p.proname LIKE 'v2_%')
 ) x;
 IF v_changed IS NOT NULL THEN
  RAISE EXCEPTION 'Existing shared staging object changed: %',v_changed
   USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regclass('public.v2_profiles') IS NULL
 OR pg_catalog.to_regclass('public.v2_profile_settings') IS NULL
 OR pg_catalog.to_regclass('public.v2_onboarding_progress') IS NULL
 OR pg_catalog.to_regclass('public.v2_legal_acceptances') IS NULL
 OR pg_catalog.to_regprocedure('public.v2_handle_new_user()') IS NULL
 THEN RAISE EXCEPTION 'Canonical profile bridge incomplete' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
  ON n.oid=c.relnamespace WHERE n.nspname='public'
  AND c.relname IN ('v2_profiles','v2_profile_settings','v2_onboarding_progress',
  'v2_legal_documents','v2_legal_acceptances') AND NOT c.relrowsecurity)
 THEN RAISE EXCEPTION 'New canonical profile table missing RLS' USING ERRCODE='42501'; END IF;
 RAISE NOTICE 'PASS review-only canonical profile bridge: existing staging tables/functions unchanged';
END $bridge_post$;
COMMIT;
