-- ALL-246 / ALL-222. REVIEW ONLY. NOT A VERSIONED MIGRATION.
-- For a fresh disposable isolated V2 test database; NEVER run on hosted V2.
-- No client/Coach role receives an EXECUTE grant or direct table privileges.
-- Training owns routine identity and immutable versions, not Completed Activity.
BEGIN;
-- Deliberate domain-version conflicts use non-retryable PostgREST PT409.
-- SQLSTATE 40001 is reserved for genuine transactional serialization failures.

CREATE TABLE public.v2_training_routines (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 current_version bigint NOT NULL DEFAULT 0 CHECK (current_version>=0),
 is_favorite boolean NOT NULL DEFAULT false,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (id,user_id)
);
CREATE TABLE public.v2_training_routine_versions (
 routine_id uuid NOT NULL,
 user_id uuid NOT NULL,
 version bigint NOT NULL CHECK (version>0),
 schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
 name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) BETWEEN 1 AND 120),
 sport text NOT NULL CHECK(sport IN
  ('running','walking','cycling','swimming','strength','hiking','rucking',
   'rowing','elliptical','stair','yoga','mobility','other')),
 notes text NOT NULL DEFAULT '' CHECK(pg_catalog.length(notes)<=1000),
 blocks jsonb NOT NULL CHECK (
  pg_catalog.jsonb_typeof(blocks)='array'
  AND pg_catalog.jsonb_array_length(blocks) BETWEEN 1 AND 60
 ),
 source_kind text NOT NULL DEFAULT 'athlete_authored'
  CHECK(source_kind='athlete_authored'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (routine_id,version),
 UNIQUE(routine_id,version,user_id),
 FOREIGN KEY(routine_id,user_id)
  REFERENCES public.v2_training_routines(id,user_id) ON DELETE CASCADE
);
ALTER TABLE public.v2_training_routines
 ADD CONSTRAINT v2_routine_current_revision_owner_fk
 FOREIGN KEY(id,current_version,user_id)
 REFERENCES public.v2_training_routine_versions(routine_id,version,user_id)
 DEFERRABLE INITIALLY DEFERRED;
-- Version 0 is used only within the initial writer transaction and is never
-- committed: a deferred composite FK requires a version on commit.

CREATE TABLE allin_private.v2_training_routine_owner_epochs (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 epoch bigint NOT NULL CHECK(epoch>=1)
);
CREATE TABLE allin_private.v2_training_routine_actions (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 action_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK(pg_catalog.length(payload_digest)=32),
 routine_id uuid NOT NULL,
 result_version bigint NOT NULL CHECK(result_version>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,action_id)
);

-- Immutable version content. A deleted Auth owner may cascade its data via
-- the approved ALL-251 account deletion flow; direct owner deletion may not.
CREATE FUNCTION allin_private.v2_training_routine_immutable_guard_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(
   SELECT 1 FROM auth.users u WHERE u.id=OLD.user_id
 ) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Saved Routine version is immutable' USING ERRCODE='42501';
END;
$guard$;
CREATE TRIGGER v2_training_routine_version_immutable
 BEFORE UPDATE OR DELETE ON public.v2_training_routine_versions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_routine_immutable_guard_candidate();

ALTER TABLE public.v2_training_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_training_routine_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_training_routine_owner_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_training_routine_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_training_routines FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.v2_training_routine_versions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_training_routine_owner_epochs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON allin_private.v2_training_routine_actions FROM PUBLIC,anon,authenticated,service_role;
-- No permissive policies are introduced: the narrow guarded owner API below
-- is the sole candidate path, never direct table access.

-- Full source-backed authoring validation, not an estimate of workout results.
CREATE FUNCTION allin_private.v2_training_routine_blocks_valid_candidate(
 p_sport text,p_blocks jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $validate$
DECLARE b jsonb; v_ids text[]:=ARRAY[]::text[]; v_id text; v_num numeric;
BEGIN
 IF p_sport IS NULL OR p_blocks IS NULL OR pg_catalog.jsonb_typeof(p_blocks)<>'array'
    OR pg_catalog.jsonb_array_length(p_blocks) NOT BETWEEN 1 AND 60 THEN RETURN false; END IF;
 FOR b IN SELECT value FROM pg_catalog.jsonb_array_elements(p_blocks)
 LOOP
  IF pg_catalog.jsonb_typeof(b)<>'object' THEN RETURN false; END IF;
  v_id:=b->>'id';
  IF v_id IS NULL OR pg_catalog.length(v_id) NOT BETWEEN 1 AND 150
     OR v_id !~ '^[A-Za-z0-9_:.-]+$' OR v_id=ANY(v_ids) THEN RETURN false; END IF;
  v_ids:=pg_catalog.array_append(v_ids,v_id);
  IF pg_catalog.jsonb_typeof(b->'notes')<>'string'
     OR pg_catalog.length(b->>'notes')>1000 THEN RETURN false; END IF;
  IF p_sport='strength' THEN
   IF NOT (b ?& ARRAY['id','kind','exercise','sets','reps','weight',
        'restSeconds','setType','equipment','notes','groupId']) THEN RETURN false; END IF;
   IF b->>'kind' IS DISTINCT FROM 'strength'
     OR pg_catalog.jsonb_typeof(b->'exercise')<>'string'
     OR pg_catalog.length(pg_catalog.btrim(b->>'exercise')) NOT BETWEEN 1 AND 150
     OR pg_catalog.jsonb_typeof(b->'sets')<>'number'
     OR b->>'sets' !~ '^[0-9]+$'
     OR (b->>'sets')::integer NOT BETWEEN 1 AND 20
     OR (b->>'setType' IS NULL OR b->>'setType' NOT IN ('warmup','working','drop','failure'))
     THEN RETURN false; END IF;
   IF (b->'reps') IS NOT NULL AND pg_catalog.jsonb_typeof(b->'reps') NOT IN ('string','null')
      OR (b->'weight') IS NOT NULL AND pg_catalog.jsonb_typeof(b->'weight') NOT IN ('string','null')
      OR (b->'equipment') IS NOT NULL AND pg_catalog.jsonb_typeof(b->'equipment') NOT IN ('string','null')
      OR (b->'groupId') IS NOT NULL AND pg_catalog.jsonb_typeof(b->'groupId') NOT IN ('string','null')
      THEN RETURN false; END IF;
   IF pg_catalog.length(b->>'reps')>60 OR pg_catalog.length(b->>'weight')>60
      OR pg_catalog.length(b->>'equipment')>100 OR pg_catalog.length(b->>'groupId')>80
      THEN RETURN false; END IF;
   IF pg_catalog.jsonb_typeof(b->'restSeconds') NOT IN ('null','number') THEN RETURN false; END IF;
   IF pg_catalog.jsonb_typeof(b->'restSeconds')='number' THEN
    IF b->>'restSeconds' !~ '^[0-9]+$' OR
      (b->>'restSeconds')::integer NOT BETWEEN 0 AND 3600 THEN RETURN false; END IF;
   END IF;
  ELSE
   IF NOT (b ?& ARRAY['id','kind','phase','repetitions','durationSeconds',
        'distance','distanceUnit','effort','notes']) THEN RETURN false; END IF;
   IF b->>'kind' IS DISTINCT FROM 'interval' OR
      (b->>'phase' IS NULL OR b->>'phase' NOT IN ('warmup','work','recovery','cooldown')) OR
      pg_catalog.jsonb_typeof(b->'repetitions')<>'number' OR
      b->>'repetitions' !~ '^[0-9]+$' OR
      (b->>'repetitions')::integer NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
   IF pg_catalog.jsonb_typeof(b->'durationSeconds') NOT IN ('null','number') OR
      pg_catalog.jsonb_typeof(b->'distance') NOT IN ('null','number') THEN RETURN false; END IF;
   IF pg_catalog.jsonb_typeof(b->'durationSeconds')='number' THEN
    IF b->>'durationSeconds' !~ '^[0-9]+$' OR
      (b->>'durationSeconds')::integer NOT BETWEEN 1 AND 86400 THEN RETURN false; END IF;
   END IF;
   IF pg_catalog.jsonb_typeof(b->'distance')='number' THEN
    v_num:=(b->>'distance')::numeric;
    IF v_num<=0 OR v_num>500000 OR b->>'distanceUnit' IS NULL OR b->>'distanceUnit' NOT IN
      ('meters','yards','kilometers','miles') THEN RETURN false; END IF;
   END IF;
   IF b->>'durationSeconds' IS NULL AND b->>'distance' IS NULL THEN RETURN false; END IF;
   IF pg_catalog.jsonb_typeof(b->'distanceUnit') NOT IN ('string','null') OR
     (b->>'distanceUnit') IS NOT NULL AND b->>'distanceUnit' NOT IN
      ('meters','yards','kilometers','miles') THEN RETURN false; END IF;
   IF pg_catalog.jsonb_typeof(b->'effort') NOT IN ('string','null') OR
      pg_catalog.length(b->>'effort')>100 THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
 THEN RETURN false;
END;
$validate$;

-- All four future server methods must call this same auth gate. A user-supplied
-- expected owner or session generation is not an authentication credential.
CREATE FUNCTION allin_private.v2_training_routine_assert_owner_candidate(
 p_expected_user_id uuid
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $owner$
DECLARE v_user uuid:=auth.uid(); v_claim text; v_sid uuid;
BEGIN
 IF v_user IS NULL OR v_user IS DISTINCT FROM p_expected_user_id THEN
  RAISE EXCEPTION 'Saved Routine owner mismatch' USING ERRCODE='42501'; END IF;
 v_claim:=auth.jwt()->>'session_id';
 IF v_claim IS NULL OR v_claim='' THEN
  RAISE EXCEPTION 'Current authenticated session required' USING ERRCODE='42501'; END IF;
 BEGIN v_sid:=v_claim::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid Auth session' USING ERRCODE='42501'; END;
 IF NOT EXISTS(
  SELECT 1 FROM auth.sessions s WHERE s.id=v_sid AND s.user_id=v_user
 ) OR NOT EXISTS(SELECT 1 FROM public.v2_profiles p WHERE p.user_id=v_user) THEN
  RAISE EXCEPTION 'Inactive Saved Routine owner session' USING ERRCODE='42501'; END IF;
END;
$owner$;

-- Internal writer only. No direct client role permission.
CREATE FUNCTION allin_private.v2_training_routine_write_candidate(
 p_expected_user_id uuid,p_routine_id uuid,p_expected_version bigint,
 p_action_id uuid,p_name text,p_sport text,p_notes text,p_blocks jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $write$
DECLARE v_id uuid;v_previous bigint;v_result bigint;v_existing allin_private.v2_training_routine_actions%ROWTYPE;
 v_digest text;v_sport text;
BEGIN
 PERFORM allin_private.v2_training_routine_assert_owner_candidate(p_expected_user_id);
 IF p_action_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0
  OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120
  OR p_sport NOT IN ('running','walking','cycling','swimming','strength','hiking',
    'rucking','rowing','elliptical','stair','yoga','mobility','other')
  OR p_notes IS NULL OR pg_catalog.length(p_notes)>1000
  OR NOT allin_private.v2_training_routine_blocks_valid_candidate(p_sport,p_blocks)
 THEN RAISE EXCEPTION 'Invalid Routine authoring request' USING ERRCODE='22023'; END IF;
 -- Revision and payload must match under exact replay. Lock per owner so a
 -- simultaneous create/update on the same action cannot race past receipt.
 v_digest:=pg_catalog.md5(pg_catalog.jsonb_build_object(
  'routineId',p_routine_id,'expectedVersion',p_expected_version,
  'name',p_name,'sport',p_sport,'notes',p_notes,'blocks',p_blocks
 )::text);
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('routine:'||p_expected_user_id::text,0));
 SELECT * INTO v_existing FROM allin_private.v2_training_routine_actions
 WHERE user_id=p_expected_user_id AND action_id=p_action_id;
 IF FOUND THEN
  IF v_existing.payload_digest<>v_digest THEN
   RAISE EXCEPTION 'Conflicting Routine action replay' USING ERRCODE='23505'; END IF;
  RETURN pg_catalog.jsonb_build_object(
   'routineId',v_existing.routine_id,'version',v_existing.result_version,'replayed',true);
 END IF;
 IF p_routine_id IS NULL THEN
  IF p_expected_version<>0 THEN
   RAISE EXCEPTION 'Create Routine expects zero prior version' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.v2_training_routines(user_id) VALUES(p_expected_user_id)
   RETURNING id INTO v_id;
  v_result:=1;
 ELSE
  SELECT r.id,r.current_version INTO v_id,v_previous
   FROM public.v2_training_routines r
   WHERE r.id=p_routine_id AND r.user_id=p_expected_user_id
     AND r.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Routine inaccessible' USING ERRCODE='42501'; END IF;
  IF v_previous<>p_expected_version THEN
   RAISE EXCEPTION 'Routine version changed' USING ERRCODE='PT409'; END IF;
  v_result:=v_previous+1;
 END IF;
 INSERT INTO public.v2_training_routine_versions
  (routine_id,user_id,version,name,sport,notes,blocks)
 VALUES(v_id,p_expected_user_id,v_result,p_name,p_sport,p_notes,p_blocks);
 UPDATE public.v2_training_routines
  SET current_version=v_result,updated_at=now() WHERE id=v_id AND user_id=p_expected_user_id;
 INSERT INTO allin_private.v2_training_routine_owner_epochs(user_id,epoch)
  VALUES(p_expected_user_id,1)
  ON CONFLICT(user_id) DO UPDATE
   SET epoch=allin_private.v2_training_routine_owner_epochs.epoch+1;
 INSERT INTO allin_private.v2_training_routine_actions
  (user_id,action_id,payload_digest,routine_id,result_version)
 VALUES(p_expected_user_id,p_action_id,v_digest,v_id,v_result);
 RETURN pg_catalog.jsonb_build_object('routineId',v_id,'version',v_result,'replayed',false);
END;
$write$;

-- No client/service_role grant to writer, or owner auth helper. A future
-- reviewed gateway is required before the app can save.
REVOKE ALL ON FUNCTION allin_private.v2_training_routine_blocks_valid_candidate(text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION allin_private.v2_training_routine_assert_owner_candidate(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION allin_private.v2_training_routine_write_candidate(
 uuid,uuid,bigint,uuid,text,text,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION allin_private.v2_training_routine_immutable_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
