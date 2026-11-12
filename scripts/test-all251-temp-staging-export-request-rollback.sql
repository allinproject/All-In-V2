-- ALL-251 hosted TEMPORARY staging acceptance, transaction rollback only.
-- This does not exercise a real HTTP bearer token, KMS or download endpoint.
BEGIN;
DO $qa$
DECLARE
  a uuid := 'a2510000-0000-4000-8000-000000000001';
  b uuid := 'b2510000-0000-4000-8000-000000000002';
  sa uuid := 'a2510000-0000-4000-8000-000000000011';
  sb uuid := 'b2510000-0000-4000-8000-000000000012';
  req uuid := 'a2510000-0000-4000-8000-000000000021';
  result jsonb;
  verified integer := 0;
BEGIN
  IF (SELECT count(*) FROM auth.users)<>0 OR (SELECT count(*) FROM auth.sessions)<>0
    OR (SELECT count(*) FROM allin_private.v2_account_export_requests_candidate)<>0
    OR (SELECT count(*) FROM allin_private.v2_account_deletion_requests)<>0
  THEN RAISE EXCEPTION 'Staging is not empty; synthetic fixture refused'; END IF;
  INSERT INTO auth.users(id,instance_id,aud,role,email)
  VALUES(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-rollback-a@invalid.example'),
        (b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-rollback-b@invalid.example');
  INSERT INTO auth.sessions(id,user_id) VALUES(sa,a),(sb,b);
  INSERT INTO allin_private.v2_account_export_requests_candidate
    (request_id,user_id,session_id,expires_at)
  VALUES(req,a,sa,now()+interval '1 hour');
  -- A real owner/session without approval may not access the archive.
  BEGIN
    PERFORM public.v2_account_export_worker_authorize_candidate(a,sa,req);
    RAISE EXCEPTION 'UNEXPECTED unauthorized request approval';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  -- Neither a foreign owner nor a foreign session can approve owner A's request.
  BEGIN
    PERFORM public.v2_account_export_worker_approve_candidate(b,sb,req);
    RAISE EXCEPTION 'UNEXPECTED foreign-owner approval';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  BEGIN
    PERFORM public.v2_account_export_worker_approve_candidate(a,sb,req);
    RAISE EXCEPTION 'UNEXPECTED foreign-session approval';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  -- Positive approval and revalidation must bind exact owner/session/request.
  result:=public.v2_account_export_worker_approve_candidate(a,sa,req);
  IF result->>'ownerId'<>a::text OR result->>'status'<>'approved'
     OR result->>'sessionId'<>sa::text OR result->>'requestId'<>req::text
  THEN RAISE EXCEPTION 'Approval returned incorrect owner/session/request'; END IF;
  result:=public.v2_account_export_worker_authorize_candidate(a,sa,req);
  IF result->>'ownerId'<>a::text OR result->>'status'<>'approved'
     OR result->>'sessionId'<>sa::text OR result->>'requestId'<>req::text
     OR result->>'cancelled'<>'false'
  THEN RAISE EXCEPTION 'Authorized read returned incorrect claim'; END IF;
  verified:=verified+1;
  -- Pending deletion blocks even previously approved export.
  INSERT INTO allin_private.v2_account_deletion_requests(user_id,status) VALUES(a,'requested');
  BEGIN
    PERFORM public.v2_account_export_worker_authorize_candidate(a,sa,req);
    RAISE EXCEPTION 'UNEXPECTED export during deletion';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  UPDATE allin_private.v2_account_deletion_requests
    SET status='cancelled',resolved_at=now() WHERE user_id=a;
  result:=public.v2_account_export_worker_authorize_candidate(a,sa,req);
  IF result->>'status'<>'approved' THEN
    RAISE EXCEPTION 'Cancelled deletion failed to restore owner export approval';
  END IF;
  verified:=verified+1;
  -- Cancelled export requests cannot become downloadable.
  UPDATE allin_private.v2_account_export_requests_candidate
     SET status='cancelled' WHERE request_id=req;
  BEGIN
    PERFORM public.v2_account_export_worker_authorize_candidate(a,sa,req);
    RAISE EXCEPTION 'UNEXPECTED cancelled request authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  -- Expired approval is always rejected.
  UPDATE allin_private.v2_account_export_requests_candidate
     SET status='approved',requested_at=now()-interval '2 hours',
         expires_at=now()-interval '1 minute'
     WHERE request_id=req;
  BEGIN
    PERFORM public.v2_account_export_worker_authorize_candidate(a,sa,req);
    RAISE EXCEPTION 'UNEXPECTED expired request authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  -- Session revocation removes the bound durable request by Auth FK cascade.
  UPDATE allin_private.v2_account_export_requests_candidate
     SET requested_at=now(),expires_at=now()+interval '1 hour'
     WHERE request_id=req;
  DELETE FROM auth.sessions WHERE id=sa;
  IF EXISTS (SELECT 1 FROM allin_private.v2_account_export_requests_candidate WHERE request_id=req)
  THEN RAISE EXCEPTION 'Revoked session left durable export request'; END IF;
  BEGIN
    PERFORM public.v2_account_export_worker_authorize_candidate(a,sa,req);
    RAISE EXCEPTION 'UNEXPECTED revoked-session authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN verified:=verified+1; END;
  IF verified<>9 THEN RAISE EXCEPTION 'Expected 9 valid acceptance assertions, got %',verified; END IF;
  RAISE NOTICE 'ALL-251 PASS 9: owner approval, unapproved/foreign/expired/cancelled/deletion/revoked denial';
END $qa$;
ROLLBACK;