-- ALL-222: bootstrap ONLY for an empty disposable PostgreSQL instance.
-- NEVER execute against Supabase, V1, canonical V2, or any populated DB.
-- Run with scripts/run-all222-cancel-isolated-replay.sh.
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA extensions;
CREATE SCHEMA allin_private;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,
  PRIMARY KEY(bucket_id,name));
CREATE TABLE allin_private.v2_account_deletion_requests(
 user_id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'requested');
CREATE TABLE allin_private.v2_privileged_storage_write_leases_review(
 lease_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id),bucket_id text NOT NULL,
 object_path text NOT NULL,operation text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 writer_sha256_review text,expires_at timestamptz NOT NULL
 DEFAULT(now()+interval '30 minutes'));
CREATE TABLE allin_private.v2_privileged_storage_writer_key_review(
 singleton boolean PRIMARY KEY,secret bytea NOT NULL);
CREATE TABLE allin_private.v2_privileged_storage_writer_nonces_review(
 nonce uuid PRIMARY KEY,action text NOT NULL,owner_id uuid NOT NULL);
INSERT INTO allin_private.v2_privileged_storage_writer_key_review
 (singleton,secret) VALUES(true,extensions.gen_random_bytes(32));

-- Reproduce unchanged deletion guard from reviewed staging function.
-- This is a test fixture, not a patch to the existing deletion guard.
CREATE FUNCTION allin_private.v2_deny_deletion_with_open_storage_leases_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fixture$
BEGIN
 IF NEW.status IN ('requested','processing') THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:'||NEW.user_id::text,0));
  IF EXISTS(
   SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review
   WHERE owner_id=NEW.user_id AND settled_at IS NULL
  ) THEN RAISE EXCEPTION 'Unresolved privileged Storage write blocks account deletion'
   USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $fixture$;
CREATE TRIGGER v2_privileged_storage_write_fence_review
BEFORE INSERT OR UPDATE ON allin_private.v2_account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION allin_private.v2_deny_deletion_with_open_storage_leases_review();
