DO $acl$
DECLARE
  client_role text;
  base_rpc text := 'public.v2_settle_privileged_storage_write_review(uuid,uuid)';
  signed_rpc text := 'public.v2_settle_privileged_storage_write_attested_review(uuid,uuid,uuid,bigint,text)';
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(client_role, base_rpc, 'EXECUTE')
      OR has_function_privilege(client_role, signed_rpc, 'EXECUTE')
          IS DISTINCT FROM (client_role = 'service_role')
    THEN
      RAISE EXCEPTION 'Unexpected settlement privilege for %', client_role;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS settlement RPC privileges';
END
$acl$;
-- Run only in the disposable PostgreSQL replay after the sequential checks.
CREATE EXTENSION dblink;

CREATE FUNCTION public.all222_race_action(scenario text, action text)
RETURNS text LANGUAGE plpgsql AS $race$
DECLARE
  owner_id uuid := overlay(overlay(md5(scenario) placing '4' from 13) placing '8' from 17)::uuid;
  fixture_lease uuid := md5(scenario || '-lease')::uuid;
  bucket text := 'v2-private-workout-objects';
  path text := owner_id::text || '/race.bin';
  digest text := repeat('a', 64);
  nonce uuid := gen_random_uuid();
  epoch bigint := extract(epoch FROM clock_timestamp())::bigint;
  signature text;
BEGIN
  CASE action
    WHEN 'cancel' THEN
      signature := public.all222_replay_signature(
        action, owner_id, bucket, path, 'create', digest, fixture_lease, nonce, epoch);
      PERFORM public.v2_cancel_privileged_storage_write_attested_review(
        owner_id, fixture_lease, bucket, path, 'create', digest, nonce, epoch, signature);
    WHEN 'settle' THEN
      signature := public.all222_replay_signature(
        action, owner_id, bucket, path, 'create', digest, fixture_lease, nonce, epoch);
      PERFORM public.v2_settle_privileged_storage_write_attested_review(
        owner_id, fixture_lease, nonce, epoch, signature);
    WHEN 'complete' THEN
      INSERT INTO storage.objects VALUES (bucket, path);
    WHEN 'delete' THEN
      INSERT INTO allin_private.v2_account_deletion_requests VALUES (owner_id, 'requested');
    ELSE RAISE EXCEPTION 'Unknown race action %', action;
  END CASE;
  RETURN 'ok';
EXCEPTION WHEN insufficient_privilege THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END
$race$;

CREATE FUNCTION public.all222_run_race(
  scenario text, first_action text, second_action text, expected_second text,
  expected_object boolean, expected_cancelled boolean,
  expected_settled boolean, expected_deletion boolean)
RETURNS void LANGUAGE plpgsql AS $race$
DECLARE
  owner_id uuid := overlay(overlay(md5(scenario) placing '4' from 13) placing '8' from 17)::uuid;
  fixture_lease uuid := md5(scenario || '-lease')::uuid;
  path text := owner_id::text || '/race.bin';
  result text;
  waiter integer;
  holder integer;
  deadline timestamptz;
BEGIN
  -- The setup is committed by a separate connection so both sessions see it.
  PERFORM dblink_exec('winner', format('INSERT INTO auth.users VALUES (%L)', owner_id));
  IF scenario <> 'deletion-first' THEN
    PERFORM dblink_exec('winner', format(
      'INSERT INTO allin_private.v2_privileged_storage_write_leases_review
       (lease_id, owner_id, bucket_id, object_path, operation, writer_sha256_review)
       VALUES (%L, %L, %L, %L, %L, %L)',
      fixture_lease, owner_id, 'v2-private-workout-objects', path, 'create', repeat('a', 64)));
  END IF;

  SELECT pid INTO holder FROM dblink('winner', 'SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO waiter FROM dblink('loser', 'SELECT pg_backend_pid()') AS t(pid integer);
  PERFORM dblink_exec('winner', 'BEGIN');
  SELECT response INTO result FROM dblink('winner',
    format('SELECT public.all222_race_action(%L, %L)', scenario, first_action)) AS t(response text);
  IF result IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION '%: first action returned %', scenario, result;
  END IF;

  PERFORM dblink_send_query('loser',
    format('SELECT public.all222_race_action(%L, %L)', scenario, second_action));
  deadline := clock_timestamp() + interval '5 seconds';
  LOOP
    EXIT WHEN holder = ANY(pg_blocking_pids(waiter));
    IF dblink_is_busy('loser') = 0 OR clock_timestamp() >= deadline THEN
      RAISE EXCEPTION '%: second action did not wait on the first transaction', scenario;
    END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;

  PERFORM dblink_exec('winner', 'COMMIT');
  SELECT response INTO result FROM dblink_get_result('loser') AS t(response text);
  PERFORM response FROM dblink_get_result('loser') AS t(response text);
  IF result IS DISTINCT FROM expected_second THEN
    RAISE EXCEPTION '%: expected %, got %', scenario, expected_second, result;
  END IF;

  IF expected_object <> EXISTS(SELECT 1 FROM storage.objects WHERE name = path)
    OR expected_cancelled <> EXISTS(
      SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review
      WHERE v2_privileged_storage_write_leases_review.lease_id = fixture_lease
        AND cancelled_at IS NOT NULL)
    OR expected_settled <> EXISTS(
      SELECT 1 FROM allin_private.v2_privileged_storage_write_leases_review
      WHERE v2_privileged_storage_write_leases_review.lease_id = fixture_lease
        AND settled_at IS NOT NULL)
    OR expected_deletion <> EXISTS(
      SELECT 1 FROM allin_private.v2_account_deletion_requests WHERE user_id = owner_id)
  THEN
    RAISE EXCEPTION '%: unexpected committed state', scenario;
  END IF;
  RAISE NOTICE 'PASS concurrency: %', scenario;
END
$race$;

SELECT dblink_connect('winner', 'host=' || current_setting('unix_socket_directories')
  || ' dbname=' || current_database() || ' options=-cstatement_timeout=10000');
SELECT dblink_connect('loser', 'host=' || current_setting('unix_socket_directories')
  || ' dbname=' || current_database() || ' options=-cstatement_timeout=10000');

SELECT public.all222_run_race('cancel-before-settle', 'cancel', 'settle',
  '42501 Attested unresolved noncancelled lease required', false, true, false, false);
SELECT public.all222_run_race('settle-before-cancel', 'settle', 'cancel',
  '42501 Exact unresolved attested lease required', false, false, true, false);
SELECT public.all222_run_race('cancel-before-completion', 'cancel', 'complete',
  '42501 Exactly one unexpired active attested Storage lease required', false, true, false, false);
SELECT public.all222_run_race('completion-before-cancel', 'complete', 'cancel',
  '42501 Completed Storage object cannot be cancelled', true, false, false, false);
SELECT public.all222_run_race('cancel-before-deletion', 'cancel', 'delete',
  '42501 Unresolved privileged Storage write blocks account deletion', false, true, false, false);
SELECT public.all222_run_race('settle-before-deletion', 'settle', 'delete',
  'ok', false, false, true, true);
SELECT public.all222_run_race('completion-before-deletion', 'complete', 'delete',
  '42501 Unresolved privileged Storage write blocks account deletion', true, false, false, false);
SELECT public.all222_run_race('deletion-first', 'delete', 'complete',
  '42501 Account deletion or absent owner blocks Storage write', false, false, false, true);

SELECT dblink_disconnect('winner');
SELECT dblink_disconnect('loser');
