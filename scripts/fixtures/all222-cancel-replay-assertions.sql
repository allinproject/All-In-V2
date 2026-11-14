-- ALL-222: execute only after the bootstrap and candidate SQL in a disposable
-- PostgreSQL instance. Synthetic data and synthetic one-time HMAC signing key.
-- A PASS here does not establish provider TUS URL revocation or release safety.
CREATE FUNCTION public.all222_replay_signature(
 p_action text,p_owner uuid,p_bucket text,p_path text,p_operation text,
 p_hash text,p_lease uuid,p_nonce uuid,p_epoch bigint)
RETURNS text LANGUAGE sql AS $$
 SELECT pg_catalog.encode(extensions.hmac(
  pg_catalog.convert_to(pg_catalog.concat_ws('|','v2-writer-v1',
   p_action,p_owner::text,p_bucket,p_path,p_operation,p_hash,
   coalesce(p_lease::text,''),p_nonce::text,p_epoch::text),'UTF8'),
  (SELECT secret FROM allin_private.v2_privileged_storage_writer_key_review
   WHERE singleton=true),'sha256'),'hex');
$$;
DO $acceptance$
DECLARE
 a uuid:='4eac09be-9845-48db-9348-474e5c08e6e8';
 b uuid:='12f80eaa-4ae8-4c9e-bdf3-972901a51426';
 l1 uuid:='4a5c3ccc-ed0a-40fa-8e77-8324c992956e';
 l2 uuid:='223a9b49-5a99-4b7f-8571-4a595504d661';
 l3 uuid:='3dcdb7a6-a38b-4349-aeab-c7a8c8ae0a39';
 l4 uuid:='4250b540-f1dc-44c8-b0c1-fd643da13c5e';
 nonce1 uuid:=gen_random_uuid();
 n uuid; ep bigint;
 bucket text:='v2-private-workout-objects';
 p1 text; p2 text; p3 text; p4 text;
 digest text:=repeat('a',64);
 sig text;
 result boolean; cnt bigint;
BEGIN
 INSERT INTO auth.users(id) VALUES(a),(b);
 p1:=a::text||'/cancel.bin';
 p2:=a::text||'/complete.bin';
 p3:=a::text||'/already-settled.bin';
 p4:=a::text||'/active.bin';
 INSERT INTO allin_private.v2_privileged_storage_write_leases_review(
  lease_id,owner_id,bucket_id,object_path,operation,writer_sha256_review,settled_at)
 VALUES
  (l1,a,bucket,p1,'create',digest,NULL),
  (l2,a,bucket,p2,'create',digest,NULL),
  (l3,a,bucket,p3,'create',digest,now()),
  (l4,a,bucket,p4,'create',digest,NULL);
 -- Simulate completed metadata *before* enabling the candidate write trigger.
 INSERT INTO storage.objects(bucket_id,name) VALUES(bucket,p2);
 ep:=pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())::bigint;
 sig:=public.all222_replay_signature('cancel',a,bucket,p1,'create',digest,l1,nonce1,ep);
 result:=public.v2_cancel_privileged_storage_write_attested_review(
  a,l1,bucket,p1,'create',digest,nonce1,ep,sig);
 IF result IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Cancel RPC did not report success'; END IF;
 SELECT count(*) INTO cnt
 FROM allin_private.v2_privileged_storage_write_leases_review
 WHERE lease_id=l1 AND cancelled_at IS NOT NULL AND settled_at IS NULL;
 IF cnt<>1 THEN RAISE EXCEPTION 'Cancellation not terminal and distinct'; END IF;
 RAISE NOTICE 'PASS 1: attested cancel sets cancelled_at only';

 -- Base settle must reject cancelled leases (including privileged caller).
 BEGIN
  PERFORM public.v2_settle_privileged_storage_write_review(a,l1);
  RAISE EXCEPTION 'Cancelled lease accepted by base settle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 2: base settle rejects cancelled lease';

 n:=gen_random_uuid();
 sig:=public.all222_replay_signature('settle',a,bucket,p1,'create',digest,l1,n,ep);
 BEGIN
  PERFORM public.v2_settle_privileged_storage_write_attested_review(a,l1,n,ep,sig);
  RAISE EXCEPTION 'Cancelled lease accepted by attested settle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 3: signed settle rejects cancelled lease';

 n:=gen_random_uuid();
 sig:=public.all222_replay_signature('cancel',a,bucket,p1,'create',digest,l1,n,ep);
 BEGIN
  PERFORM public.v2_cancel_privileged_storage_write_attested_review(
   a,l1,bucket,p1,'create',digest,n,ep,sig);
  RAISE EXCEPTION 'Double cancellation succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 4: double cancellation denied';

 -- A second, otherwise valid lease must reject a previously consumed nonce.
 sig:=public.all222_replay_signature('cancel',a,bucket,p2,'create',digest,l2,nonce1,ep);
 BEGIN
  PERFORM public.v2_cancel_privileged_storage_write_attested_review(
   a,l2,bucket,p2,'create',digest,nonce1,ep,sig);
  RAISE EXCEPTION 'Replayed nonce accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 5: HMAC nonce replay rejected';

 n:=gen_random_uuid();
 BEGIN
  PERFORM public.v2_cancel_privileged_storage_write_attested_review(
   a,l4,bucket,p4,'create',digest,n,ep,repeat('0',64));
  RAISE EXCEPTION 'Invalid HMAC accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 6: invalid HMAC rejected';

 n:=gen_random_uuid();
 sig:=public.all222_replay_signature('cancel',b,bucket,p4,'create',digest,l4,n,ep);
 BEGIN
  PERFORM public.v2_cancel_privileged_storage_write_attested_review(
   b,l4,bucket,p4,'create',digest,n,ep,sig);
  RAISE EXCEPTION 'Wrong-owner cancellation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 7: wrong-owner lease rejected';

 n:=gen_random_uuid();
 sig:=public.all222_replay_signature('cancel',a,bucket,p2,'create',digest,l2,n,ep);
 BEGIN
  PERFORM public.v2_cancel_privileged_storage_write_attested_review(
   a,l2,bucket,p2,'create',digest,n,ep,sig);
  RAISE EXCEPTION 'Completed object cancellation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 8: existing completed object cannot be cancelled';

 n:=gen_random_uuid();
 sig:=public.all222_replay_signature('cancel',a,bucket,p3,'create',digest,l3,n,ep);
 BEGIN
  PERFORM public.v2_cancel_privileged_storage_write_attested_review(
   a,l3,bucket,p3,'create',digest,n,ep,sig);
  RAISE EXCEPTION 'Already settled lease cancellation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 9: settled lease cannot be cancelled';

 BEGIN
  UPDATE allin_private.v2_privileged_storage_write_leases_review
  SET settled_at=now() WHERE lease_id=l1;
  RAISE EXCEPTION 'Mutually exclusive terminal state constraint failed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 RAISE NOTICE 'PASS 10: settled/cancelled mutual exclusion enforced';

 IF pg_catalog.has_function_privilege('anon',
  'public.v2_cancel_privileged_storage_write_attested_review(uuid,uuid,text,text,text,text,uuid,bigint,text)',
  'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',
  'public.v2_cancel_privileged_storage_write_attested_review(uuid,uuid,text,text,text,text,uuid,bigint,text)',
  'EXECUTE') THEN
  RAISE EXCEPTION 'Client role can invoke cancellation'; END IF;
 IF NOT pg_catalog.has_function_privilege('service_role',
  'public.v2_cancel_privileged_storage_write_attested_review(uuid,uuid,text,text,text,text,uuid,bigint,text)',
  'EXECUTE') THEN
  RAISE EXCEPTION 'Service role cannot invoke cancellation'; END IF;
 RAISE NOTICE 'PASS 11: cancellation service-only execute privileges';

 -- Existing, unchanged deletion guard STILL blocks cancelled but unsettled lease.
 BEGIN
  INSERT INTO allin_private.v2_account_deletion_requests(user_id,status)
  VALUES(a,'requested');
  RAISE EXCEPTION 'Cancellation prematurely unlocked deletion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 12: cancellation does not unlock account deletion';

END $acceptance$;

-- Exercise real trigger after cancelled lease, not only string matching.
CREATE TRIGGER all222_metadata_fence
BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW
EXECUTE FUNCTION allin_private.v2_deny_unleased_storage_object_write_review();
DO $metadata$
DECLARE a uuid:='4eac09be-9845-48db-9348-474e5c08e6e8';
 b text:='v2-private-workout-objects';
BEGIN
 -- An active lease with matching object path still permits metadata creation.
 INSERT INTO storage.objects(bucket_id,name) VALUES(
  b,a::text||'/active.bin');
 RAISE NOTICE 'PASS 13: active attested lease still permits metadata write';
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES(
   b,a::text||'/cancel.bin');
  RAISE EXCEPTION 'Cancelled lease permitted a Storage object write';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS 14: cancelled lease blocks Storage object write';
END $metadata$;

-- The disposable container is destroyed by the runner. No hosted writes.
