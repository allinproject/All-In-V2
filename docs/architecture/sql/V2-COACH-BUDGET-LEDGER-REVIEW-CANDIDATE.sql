-- ALL-217 / ALL-222 REVIEW ONLY. Not a production migration.
-- Private, per-owner monthly hard cap with transaction-serialized reservations.
-- Requires the canonical owner/Auth and account-deletion/export inventory review.
-- No mobile or authenticated-role privileges; writer called ONLY by the
-- verified Coach server with service_role and server-reviewed price ceiling.
BEGIN;
CREATE TABLE allin_private.v2_coach_budget_periods (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 period_start date NOT NULL,
 cap_usd numeric(12,6) NOT NULL DEFAULT 0.750000
   CHECK(cap_usd>0 AND cap_usd<=0.750000),
 held_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK(held_usd>=0),
 spent_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK(spent_usd>=0),
 PRIMARY KEY(user_id,period_start),
 CHECK(held_usd+spent_usd<=cap_usd)
);
CREATE TABLE allin_private.v2_coach_budget_reservations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 client_request_id uuid NOT NULL,
 reservation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 period_start date NOT NULL,
 maximum_usd numeric(12,6) NOT NULL CHECK(maximum_usd>0 AND maximum_usd<=0.010000),
 output_token_limit integer NOT NULL CHECK(output_token_limit BETWEEN 16 AND 1024),
 status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','settled','released')),
 metered_input_tokens integer CHECK(metered_input_tokens>=0),
 metered_output_tokens integer CHECK(metered_output_tokens>=0),
 settled_usd numeric(12,6) CHECK(settled_usd>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 PRIMARY KEY(user_id,client_request_id),
 FOREIGN KEY(user_id,period_start) REFERENCES allin_private.v2_coach_budget_periods(user_id,period_start),
 CHECK((status='settled' AND settled_usd IS NOT NULL AND settled_at IS NOT NULL
   AND metered_input_tokens IS NOT NULL AND metered_output_tokens IS NOT NULL)
  OR (status<>'settled' AND settled_usd IS NULL AND settled_at IS NULL
   AND metered_input_tokens IS NULL AND metered_output_tokens IS NULL))
);
CREATE INDEX v2_coach_budget_reservations_period
 ON allin_private.v2_coach_budget_reservations(user_id,period_start,status);
ALTER TABLE allin_private.v2_coach_budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_coach_budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_coach_budget_periods
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_coach_budget_reservations
 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA allin_private TO service_role;
GRANT SELECT,INSERT,UPDATE ON allin_private.v2_coach_budget_periods TO service_role;
GRANT SELECT,INSERT,UPDATE ON allin_private.v2_coach_budget_reservations TO service_role;

-- The caller provides a maximum as a reviewed server policy. NEVER accept a
-- caller-supplied spending cap or price/model. Duplicate request keys cannot
-- authorize a second charged provider invocation, including after timeout.
CREATE FUNCTION public.v2_coach_budget_reserve(
 p_user_id uuid,p_client_request_id uuid,p_maximum_usd numeric,
 p_max_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
 SET search_path='' AS $reserve$
DECLARE v_period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date;
 v_account allin_private.v2_coach_budget_periods%ROWTYPE;
 v_record allin_private.v2_coach_budget_reservations%ROWTYPE;
BEGIN
 IF p_user_id IS NULL OR p_client_request_id IS NULL OR
    p_maximum_usd IS NULL OR p_maximum_usd<=0 OR
    p_maximum_usd>0.010000 OR p_max_output_tokens NOT BETWEEN 16 AND 1024
 THEN RAISE EXCEPTION 'Coach budget invalid' USING ERRCODE='22023'; END IF;
 -- This serializes even the first reservation for a new owner/period.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-coach-budget:'||p_user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
  RAISE EXCEPTION 'Coach owner absent' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_record FROM allin_private.v2_coach_budget_reservations
  WHERE user_id=p_user_id AND client_request_id=p_client_request_id;
 IF FOUND THEN
  RETURN pg_catalog.jsonb_build_object('approved',false,'reason','existing_request');
 END IF;
 INSERT INTO allin_private.v2_coach_budget_periods(user_id,period_start)
 VALUES(p_user_id,v_period) ON CONFLICT DO NOTHING;
 SELECT * INTO v_account FROM allin_private.v2_coach_budget_periods
  WHERE user_id=p_user_id AND period_start=v_period FOR UPDATE;
 IF v_account.spent_usd+v_account.held_usd+p_maximum_usd>v_account.cap_usd THEN
  RETURN pg_catalog.jsonb_build_object('approved',false,'reason','monthly_cap_reached');
 END IF;
 INSERT INTO allin_private.v2_coach_budget_reservations(
  user_id,client_request_id,period_start,maximum_usd,output_token_limit)
 VALUES(p_user_id,p_client_request_id,v_period,p_maximum_usd,p_max_output_tokens)
 RETURNING * INTO v_record;
 UPDATE allin_private.v2_coach_budget_periods SET held_usd=held_usd+p_maximum_usd
 WHERE user_id=p_user_id AND period_start=v_period;
 RETURN pg_catalog.jsonb_build_object('approved',true,
  'ownerId',p_user_id,'clientRequestId',p_client_request_id,
  'reservationId',v_record.reservation_id,'maximumUsd',v_record.maximum_usd);
END;$reserve$;

CREATE FUNCTION public.v2_coach_budget_settle(
 p_user_id uuid,p_client_request_id uuid,p_reservation_id uuid,
 p_input_tokens integer,p_output_tokens integer,p_cost_usd numeric
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
 SET search_path='' AS $settle$
DECLARE v_record allin_private.v2_coach_budget_reservations%ROWTYPE;
BEGIN
 IF p_user_id IS NULL OR p_client_request_id IS NULL OR
    p_reservation_id IS NULL OR p_cost_usd IS NULL OR
    p_cost_usd<0 OR p_input_tokens<0 OR p_output_tokens<0 OR
    p_input_tokens IS NULL OR p_output_tokens IS NULL THEN
  RAISE EXCEPTION 'Invalid Coach settlement' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-coach-budget:'||p_user_id::text,0));
 SELECT * INTO v_record FROM allin_private.v2_coach_budget_reservations
  WHERE user_id=p_user_id AND client_request_id=p_client_request_id
    AND reservation_id=p_reservation_id FOR UPDATE;
 IF NOT FOUND OR p_cost_usd>v_record.maximum_usd THEN
  RAISE EXCEPTION 'Coach settlement missing or exceeds reservation'
   USING ERRCODE='42501'; END IF;
 IF v_record.status='settled' THEN
  IF v_record.settled_usd IS DISTINCT FROM p_cost_usd OR
    v_record.metered_input_tokens IS DISTINCT FROM p_input_tokens OR
    v_record.metered_output_tokens IS DISTINCT FROM p_output_tokens THEN
   RAISE EXCEPTION 'Conflicting Coach settlement replay' USING ERRCODE='23505'; END IF;
 ELSE
  IF v_record.status<>'held' THEN
   RAISE EXCEPTION 'Released Coach reservation cannot settle'
    USING ERRCODE='42501'; END IF;
  UPDATE allin_private.v2_coach_budget_reservations SET status='settled',
   settled_usd=p_cost_usd,metered_input_tokens=p_input_tokens,
   metered_output_tokens=p_output_tokens,settled_at=now()
   WHERE user_id=p_user_id AND client_request_id=p_client_request_id;
  UPDATE allin_private.v2_coach_budget_periods
   SET held_usd=held_usd-v_record.maximum_usd,spent_usd=spent_usd+p_cost_usd
   WHERE user_id=p_user_id AND period_start=v_record.period_start;
 END IF;
 RETURN pg_catalog.jsonb_build_object('confirmed',true,
  'ownerId',p_user_id,'clientRequestId',p_client_request_id);
END;$settle$;

-- Intentionally NO automatic release on unknown HTTP failures. Provider-side
-- acceptance/billing may have occurred. A separately reviewed reconciliation
-- operator can release only with positive no-charge evidence in a future slice.
REVOKE ALL ON FUNCTION public.v2_coach_budget_reserve(uuid,uuid,numeric,integer)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_coach_budget_settle(uuid,uuid,uuid,integer,integer,numeric)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_coach_budget_reserve(uuid,uuid,numeric,integer)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_coach_budget_settle(uuid,uuid,uuid,integer,integer,numeric)
 TO service_role;
COMMIT;
