\set ON_ERROR_STOP on
-- Reproduce ONLY required existing shared-staging contract for isolated review.
-- Test fixtures, not a dump or any real hosted staging credentials/content.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA allin_private;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY,
 raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
INSERT INTO auth.users (id,raw_user_meta_data)
 VALUES ('11111111-1111-4111-8111-111111111111','{"display_name":"preserved-staging-test"}');
CREATE TABLE allin_private.v2_account_deletion_requests (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 status text NOT NULL CHECK(status IN ('requested','processing','completed','rejected','cancelled'))
);
CREATE TABLE allin_private.v2_account_export_requests_candidate (
 request_id uuid PRIMARY KEY,
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.v2_coach_threads (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.v2_coach_messages (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.v2_food_log_entries (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.v2_ingredients (id uuid PRIMARY KEY, canonical_key text NOT NULL UNIQUE);
CREATE FUNCTION public.v2_coach_read_messages() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
REVOKE ALL ON FUNCTION public.v2_coach_read_messages() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_coach_read_messages() TO authenticated;
ALTER TABLE allin_private.v2_account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_account_export_requests_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_coach_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_coach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_food_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_ingredients ENABLE ROW LEVEL SECURITY;
INSERT INTO allin_private.v2_account_deletion_requests(user_id, status)
 VALUES('11111111-1111-4111-8111-111111111111','cancelled');
INSERT INTO allin_private.v2_account_export_requests_candidate(request_id,user_id)
 VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
INSERT INTO public.v2_coach_threads(id,user_id)
 VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
INSERT INTO public.v2_coach_messages(id,user_id)
 VALUES('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111');
INSERT INTO public.v2_food_log_entries(id,user_id)
 VALUES('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111');
INSERT INTO public.v2_ingredients(id,canonical_key)
 VALUES('66666666-6666-4666-8666-666666666666','preserve-ingredient');
