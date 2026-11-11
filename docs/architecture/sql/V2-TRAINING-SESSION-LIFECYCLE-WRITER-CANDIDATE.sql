-- ALL-246 / ALL-243 REVIEW ONLY: canonical Training lifecycle and completion outbox.
-- NOT A MIGRATION. NOT a client RPC. No V2 hosted deployment.
-- This extends the existing owner identity candidate; no new workout table.
-- Private, invoker-only service contract; do not expose to authenticated users.
CREATE TABLE allin_private.v2_training_action_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  session_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN ('start','pause','resume','finish','cancel')),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint)=64
    AND request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_version bigint NOT NULL CHECK (result_version>=1),
  result_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,action_id),
  FOREIGN KEY(session_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id)
);
CREATE TABLE public.v2_training_execution_events (
  id uuid PRIMARY KEY,
  session_instance_id uuid NOT NULL,
  user_id uuid NOT NULL,
  sequence_number bigint NOT NULL CHECK(sequence_number>=1),
  event_type text NOT NULL CHECK(event_type IN ('start','pause','resume','finish','cancel')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_action_id uuid NOT NULL,
  event_schema_version text NOT NULL DEFAULT 'session-v1'
    CHECK(event_schema_version='session-v1'),
  UNIQUE(session_instance_id,sequence_number),
  UNIQUE(user_id,client_action_id),
  FOREIGN KEY(session_instance_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id)
);
CREATE TABLE allin_private.v2_training_completion_outbox (
  session_instance_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  action_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  FOREIGN KEY(session_instance_id,user_id)
    REFERENCES public.v2_training_session_instances(id,user_id),
  UNIQUE(user_id,action_id)
);
ALTER TABLE allin_private.v2_training_action_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_training_completion_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_training_action_receipts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.v2_training_execution_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_training_completion_outbox FROM PUBLIC,anon,authenticated,service_role;

-- This function has NO client privilege, and does not claim client authorization.
-- It is invoked ONLY by a future owner-reviewed trusted server action that
-- authenticates the actual actor, checks account/session and supplies owner.
-- It cannot itself be offered as a public mutation endpoint.
CREATE FUNCTION allin_private.v2_training_apply_session_candidate(
 p_user_id uuid,p_session_id uuid,p_action_id uuid,p_command text,
 p_expected_version bigint,p_request_fingerprint text,
 p_local_date date,p_timezone text,p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $writer$
DECLARE
 v_session public.v2_training_session_instances%ROWTYPE;
 v_receipt allin_private.v2_training_action_receipts%ROWTYPE;
 v_next_status text;
 v_next_version bigint;
BEGIN
 IF p_user_id IS NULL OR p_session_id IS NULL OR p_action_id IS NULL
    OR p_occurred_at IS NULL OR p_command NOT IN ('start','pause','resume','finish','cancel')
    OR p_command IS NULL OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid canonical session action' USING ERRCODE='22023'; END IF;
 -- All action IDs for the same owner are serialized before receipt check.
 -- Prevents two concurrent first-time actions from racing the same session.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(p_user_id::text,0)
 );
 SELECT * INTO v_receipt FROM allin_private.v2_training_action_receipts
   WHERE user_id=p_user_id AND action_id=p_action_id;
 IF FOUND THEN
   IF v_receipt.session_id<>p_session_id OR v_receipt.command<>p_command OR
      v_receipt.request_fingerprint<>p_request_fingerprint
   THEN RAISE EXCEPTION 'Conflicting canonical action replay' USING ERRCODE='23505'; END IF;
   RETURN pg_catalog.jsonb_build_object('sessionId',p_session_id,
      'version',v_receipt.result_version,'status',v_receipt.result_status,'replayed',true);
 END IF;
 IF p_command='start' THEN
   IF p_expected_version<>0 OR p_local_date IS NULL OR p_timezone IS NULL
      OR length(pg_catalog.btrim(p_timezone))=0
   THEN RAISE EXCEPTION 'Invalid start expected version or date' USING ERRCODE='22023'; END IF;
   INSERT INTO public.v2_training_session_instances
    (id,user_id,status,source_kind,athlete_local_date,timezone,started_at)
   VALUES(p_session_id,p_user_id,'active','phone',p_local_date,p_timezone,p_occurred_at);
   v_next_status:='active'; v_next_version:=1;
 ELSE
   SELECT * INTO v_session FROM public.v2_training_session_instances
    WHERE id=p_session_id AND user_id=p_user_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Session owner mismatch or not found' USING ERRCODE='42501'; END IF;
   IF p_expected_version IS DISTINCT FROM v_session.version THEN
      RAISE EXCEPTION 'Stale canonical session version' USING ERRCODE='40001'; END IF;
   v_next_status:=CASE
    WHEN p_command='pause' AND v_session.status='active' THEN 'paused'
    WHEN p_command='resume' AND v_session.status='paused' THEN 'active'
    WHEN p_command='finish' AND v_session.status IN ('active','paused') THEN 'completed'
    WHEN p_command='cancel' AND v_session.status IN ('active','paused') THEN 'cancelled'
    ELSE NULL END;
   IF v_next_status IS NULL THEN
      RAISE EXCEPTION 'Illegal session lifecycle transition' USING ERRCODE='22023'; END IF;
   v_next_version:=v_session.version+1;
   UPDATE public.v2_training_session_instances
    SET status=v_next_status,version=v_next_version,
        last_event_sequence=v_next_version,
        finished_at=CASE WHEN v_next_status IN ('completed','cancelled') THEN p_occurred_at ELSE NULL END,
        updated_at=now()
    WHERE id=p_session_id AND user_id=p_user_id;
 END IF;
 IF p_command='start' THEN
   UPDATE public.v2_training_session_instances SET last_event_sequence=1 WHERE id=p_session_id;
 END IF;
 INSERT INTO public.v2_training_execution_events
   (id,session_instance_id,user_id,sequence_number,event_type,occurred_at,client_action_id)
 VALUES(p_action_id,p_session_id,p_user_id,v_next_version,p_command,p_occurred_at,p_action_id);
 IF p_command='finish' THEN
   INSERT INTO allin_private.v2_training_completion_outbox
    (session_instance_id,user_id,action_id)
   VALUES(p_session_id,p_user_id,p_action_id);
 END IF;
 INSERT INTO allin_private.v2_training_action_receipts
   (user_id,action_id,session_id,command,request_fingerprint,result_version,result_status)
 VALUES(p_user_id,p_action_id,p_session_id,p_command,p_request_fingerprint,v_next_version,v_next_status);
 RETURN pg_catalog.jsonb_build_object('sessionId',p_session_id,
     'version',v_next_version,'status',v_next_status,'replayed',false);
END;
$writer$;
REVOKE ALL ON FUNCTION allin_private.v2_training_apply_session_candidate(
 uuid,uuid,uuid,text,bigint,text,date,text,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
-- No user-facing function GRANT, trigger, workout creation or outbox worker.
