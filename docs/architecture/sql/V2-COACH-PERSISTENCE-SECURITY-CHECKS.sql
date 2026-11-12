-- ALL-222 review-only Coach schema security checks for a disposable LOCAL DB.
-- Execute only AFTER installing docs/architecture/sql/V2-COACH-PERSISTENCE-CANDIDATE.sql
-- on isolated local Supabase. No schema changes or fixture owners in this script.
-- Expected result: one row showing 0 violations, otherwise exception.
DO $$
DECLARE v_errors text[] := ARRAY[]::text[];
DECLARE v_rel text;
DECLARE v_fn text;
BEGIN
  FOREACH v_rel IN ARRAY ARRAY[
    'public.v2_coach_threads',
    'public.v2_coach_messages',
    'allin_private.v2_coach_message_actions'
  ] LOOP
    IF to_regclass(v_rel) IS NULL THEN
      v_errors := array_append(v_errors, 'missing relation: ' || v_rel);
    ELSIF NOT (SELECT c.relrowsecurity FROM pg_class c
      WHERE c.oid = to_regclass(v_rel)) THEN
      v_errors := array_append(v_errors, 'RLS disabled: ' || v_rel);
    END IF;
    IF to_regclass(v_rel) IS NOT NULL
       AND (has_table_privilege('anon',v_rel,'SELECT')
         OR has_table_privilege('anon',v_rel,'INSERT')
         OR has_table_privilege('anon',v_rel,'UPDATE')
         OR has_table_privilege('anon',v_rel,'DELETE')
         OR has_table_privilege('authenticated',v_rel,'SELECT')
         OR has_table_privilege('authenticated',v_rel,'INSERT')
         OR has_table_privilege('authenticated',v_rel,'UPDATE')
         OR has_table_privilege('authenticated',v_rel,'DELETE')) THEN
      v_errors := array_append(v_errors, 'direct API access: ' || v_rel);
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.v2_coach_get_or_create_thread()',
    'public.v2_coach_append_user_message(uuid,uuid,text)',
    'public.v2_coach_read_messages(uuid,integer,timestamptz,uuid)',
    'public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      v_errors := array_append(v_errors, 'missing function: ' || v_fn);
    END IF;
  END LOOP;

  IF to_regprocedure('public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text)') IS NOT NULL THEN
    IF has_function_privilege('anon','public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text)','EXECUTE')
      OR has_function_privilege('authenticated','public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text)','EXECUTE')
      OR NOT has_function_privilege('service_role','public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text)','EXECUTE')
    THEN
      v_errors := array_append(v_errors,'assistant writer grant violation');
    END IF;
  END IF;

  IF to_regprocedure('public.v2_coach_get_or_create_thread()') IS NOT NULL THEN
    IF has_function_privilege('anon','public.v2_coach_get_or_create_thread()','EXECUTE')
      OR NOT has_function_privilege('authenticated','public.v2_coach_get_or_create_thread()','EXECUTE')
    THEN
      v_errors := array_append(v_errors,'thread lifecycle grant violation');
    END IF;
  END IF;

  IF array_length(v_errors,1) IS NOT NULL THEN
    RAISE EXCEPTION 'Coach physical contract violations: %', array_to_string(v_errors,'; ');
  END IF;
  RAISE NOTICE 'PASS: Coach RLS object presence and API grant checks';
END
$$;

-- Required separate authenticated integration replay in isolated DB:
-- * create two genuine LOCAL Auth owners; verify account-switched JWT identity
-- * same owner first-open twice (including simultaneous) -> same thread ID
-- * append exact action twice -> same ID and one message/ledger row
-- * same action ID + different body -> 23505; owner B's thread -> 42501
-- * same service reply ID twice -> same ID, differing reply -> 23505
-- * anon cannot execute readers/writers; authenticated cannot execute reply writer
-- * history cursor with identical created_at timestamps has no gaps/duplicates
-- * token refresh and restart client use the identical owner/thread
-- * messages cannot be directly inserted/changed/deleted using authenticated role
-- * deleting owner removes thread/message/action rows; privacy export includes them
-- * no V1 service URL/JWT, no Coach health read without explicit opt-in.
-- Do not mark these behavioral assertions PASS without executing their replay.
