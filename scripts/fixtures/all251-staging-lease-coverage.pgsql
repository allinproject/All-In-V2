\set ON_ERROR_STOP on
-- Synthetic, no actual hosted project, no Storage API writes or Auth deletion.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA allin_private;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE storage.buckets(id text PRIMARY KEY);
CREATE TABLE storage.objects(id uuid PRIMARY KEY);
CREATE TABLE allin_private.v2_account_deletion_requests(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE allin_private.v2_privileged_storage_write_leases_review(
 lease_id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 settled_at timestamptz
);
ALTER TABLE allin_private.v2_account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_privileged_storage_write_leases_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA allin_private FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO storage.buckets(id) VALUES('v2-private-workout-objects');
CREATE FUNCTION allin_private.v2_test_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fence$
BEGIN
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $fence$;
