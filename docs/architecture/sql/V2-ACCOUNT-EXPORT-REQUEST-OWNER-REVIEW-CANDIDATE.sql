-- ALL-251 REVIEW ONLY — durable requests owned by EXISTING account export.
-- NOT A MIGRATION. No client writer, no worker scheduling, no grants.
-- The existing account-export Profile flow remains the sole initiation UX.
-- This model stores an explicit server-reviewed export job identity so a valid
-- login alone cannot open arbitrary historical private workout files.
CREATE TABLE allin_private.v2_account_export_requests_candidate (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'requested'
   CHECK(status IN ('requested','approved','staging','staged','expired','cancelled','failed')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>requested_at AND expires_at<=requested_at+interval '24 hours')
);
CREATE INDEX v2_export_req_owner_status ON allin_private.v2_account_export_requests_candidate(user_id,status);
ALTER TABLE allin_private.v2_account_export_requests_candidate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_account_export_requests_candidate FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION allin_private.v2_account_export_authorize_request_candidate(
 p_user_id uuid,p_session_id uuid,p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $auth$
DECLARE
 v_session jsonb;
 v_request allin_private.v2_account_export_requests_candidate%ROWTYPE;
BEGIN
 v_session:=allin_private.v2_account_export_authorize_session_candidate(p_user_id,p_session_id);
 IF v_session->>'activeSession'<>'true'
 THEN RAISE EXCEPTION 'Current Auth session is not eligible' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_request FROM allin_private.v2_account_export_requests_candidate
 WHERE request_id=p_request_id AND user_id=p_user_id
   AND session_id=p_session_id;
 IF NOT FOUND OR v_request.status NOT IN ('approved','staging','staged')
   OR v_request.expires_at<=pg_catalog.now()
 THEN RAISE EXCEPTION 'Export request is not approved or has expired' USING ERRCODE='42501'; END IF;
 RETURN pg_catalog.jsonb_build_object('requestId',p_request_id,
  'ownerId',p_user_id,'sessionId',p_session_id,
  'status','approved','cancelled',false,'expiresAt',v_request.expires_at);
END;
$auth$;
REVOKE ALL ON FUNCTION
 allin_private.v2_account_export_authorize_request_candidate(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- No client request creation or service grant until canonical ALL-251
-- export worker, migration/rollback and personal-data coverage are approved.
