-- ALL-243 REVIEW ONLY. NOT A VERSIONED MIGRATION; DO NOT APPLY TO HOSTED V2.
-- Requires the approved canonical Completed Activity and scalar metric candidates.
-- The NOLOGIN role is an internal execution capability, never a client JWT role.
-- An upstream authenticated gateway MUST verify the athlete's active session,
-- provider evidence, source registration, and bind owner/source/activity.
-- PostgreSQL rejects cross-owner references and atomically deduplicates callbacks.
BEGIN;
DO $role$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='allin_v2_device_ingest') THEN
  CREATE ROLE allin_v2_device_ingest NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $role$;
-- No membership grants to authenticator, service_role, anon or authenticated.
GRANT USAGE ON SCHEMA allin_private TO allin_v2_device_ingest;
GRANT USAGE ON SCHEMA public TO allin_v2_device_ingest;
-- SECURITY INVOKER canonical writer requires exactly these existing table rights.
GRANT SELECT ON public.v2_completed_activities TO allin_v2_device_ingest;
GRANT SELECT ON public.v2_activity_sources TO allin_v2_device_ingest;
GRANT SELECT ON public.v2_activity_metric_definitions TO allin_v2_device_ingest;
GRANT SELECT,INSERT ON public.v2_activity_metric_values TO allin_v2_device_ingest;
-- RLS policies for this dedicated role must be owner-scoped and reviewed before
-- activation. Do not use BYPASSRLS or blanket authenticated policies.
CREATE TABLE allin_private.v2_device_ingest_nonce_candidate(
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[0-9a-f]{64}$'),
 owner_id uuid NOT NULL,
 activity_id uuid NOT NULL,
 source_id uuid NOT NULL,
 callback_hash text NOT NULL CHECK(callback_hash ~ '^[0-9a-f]{64}$'),
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(nonce_hash,owner_id,activity_id,source_id)
);
REVOKE ALL ON allin_private.v2_device_ingest_nonce_candidate
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON allin_private.v2_device_ingest_nonce_candidate
 TO allin_v2_device_ingest;
ALTER TABLE allin_private.v2_device_ingest_nonce_candidate ENABLE ROW LEVEL SECURITY;
-- No permissive RLS policy until the authenticated owner-binding design is
-- finalized. This intentionally fails closed in an unprivileged environment.
CREATE FUNCTION allin_private.v2_device_ingest_scalar_gateway_candidate(
 p_nonce_hash text,p_callback_hash text,
 p_owner_id uuid,p_activity_id uuid,p_source_id uuid,p_value_id uuid,
 p_metric_code text,p_definition_version integer,p_measurement_kind text,
 p_value_numeric numeric,p_value_text text,p_value_boolean boolean,
 p_source_payload_hash text,p_measurement_quality text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $gateway$
DECLARE v_result jsonb;
BEGIN
 IF current_user <> 'allin_v2_device_ingest' THEN
  RAISE EXCEPTION 'Private ingest principal required' USING ERRCODE='42501';
 END IF;
 IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$'
  OR p_callback_hash IS NULL OR p_callback_hash !~ '^[0-9a-f]{64}$'
  OR p_owner_id IS NULL OR p_activity_id IS NULL OR p_source_id IS NULL THEN
  RAISE EXCEPTION 'Invalid callback binding' USING ERRCODE='22023';
 END IF;
 -- Transaction-scoped owner lock serializes nonce + canonical writer.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-device-ingest:'||p_owner_id::text,0));
 -- Source/activity and evidence are checked by the existing canonical writer.
 -- Duplicate nonce is a hard failure; never claim a changed payload is replay.
 INSERT INTO allin_private.v2_device_ingest_nonce_candidate
  (nonce_hash,owner_id,activity_id,source_id,callback_hash)
 VALUES(p_nonce_hash,p_owner_id,p_activity_id,p_source_id,p_callback_hash)
 ON CONFLICT(nonce_hash) DO NOTHING;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Device callback nonce already consumed' USING ERRCODE='23505';
 END IF;
 v_result:=allin_private.v2_activity_append_scalar_candidate(
  p_owner_id,p_activity_id,p_source_id,p_value_id,p_metric_code,
  p_definition_version,p_measurement_kind,p_value_numeric,p_value_text,
  p_value_boolean,p_source_payload_hash,p_measurement_quality);
 RETURN v_result;
END;
$gateway$;
REVOKE ALL ON FUNCTION allin_private.v2_device_ingest_scalar_gateway_candidate(
 text,text,uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION allin_private.v2_activity_append_scalar_candidate(
 uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text,text)
 TO allin_v2_device_ingest;
GRANT EXECUTE ON FUNCTION allin_private.v2_device_ingest_scalar_gateway_candidate(
 text,text,uuid,uuid,uuid,uuid,text,integer,text,numeric,text,boolean,text,text)
 TO allin_v2_device_ingest;
COMMIT;
-- RELEASE BLOCKERS: dedicated role must have carefully reviewed owner-bound RLS;
-- secure server session + native provider attestation; nonce retention/cleanup;
-- source registration and stable source-to-activity mapping; batched atomic
-- callbacks; concurrency/denial tests; rollback plan; production approval.
