-- ALL-251/ALL-246 REVIEW ONLY: protect immutable Training history while
-- allowing an actual deleted Auth owner to cascade through historical plans.
-- NOT A MIGRATION. Tested only after the original immutable-guard candidate.
-- A direct DELETE on an active account remains prohibited. This is NOT an
-- account-deletion trigger, endpoint, authorization token or bypass grant.
CREATE OR REPLACE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
DECLARE
 v_old_status text;
 v_new_status text;
BEGIN
 -- Account teardown is the only condition under which historical records
 -- may be removed. A single Auth deletion statement has already removed the
 -- owner identity by the time AFTER DELETE FK cascades enter these triggers.
 -- Direct deletes while the Auth owner exists stay prohibited.
 IF TG_OP='DELETE' AND NOT EXISTS (
   SELECT 1 FROM auth.users WHERE id=OLD.user_id
 ) THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='v2_training_plan_revisions' THEN
  IF TG_OP='DELETE' AND OLD.status<>'candidate' THEN
    RAISE EXCEPTION 'Historical Training revision cannot be deleted' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status<>'candidate' THEN
    IF OLD.status<>'accepted' OR NEW.status<>'superseded'
      OR (pg_catalog.to_jsonb(NEW)-'status') IS DISTINCT FROM
         (pg_catalog.to_jsonb(OLD)-'status') THEN
      RAISE EXCEPTION 'Accepted Training revision content cannot change'
       USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END IF;
 -- A revision-day/session belongs to precisely one immutable snapshot.
 IF TG_OP IN ('UPDATE','DELETE') THEN
  SELECT status INTO v_old_status FROM public.v2_training_plan_revisions
    WHERE id=OLD.plan_revision_id;
  IF v_old_status IS DISTINCT FROM 'candidate' THEN
    RAISE EXCEPTION 'Published Training revision children cannot change'
      USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  SELECT status INTO v_new_status FROM public.v2_training_plan_revisions
    WHERE id=NEW.plan_revision_id;
  IF v_new_status IS DISTINCT FROM 'candidate' THEN
    RAISE EXCEPTION 'Published Training revision children cannot be added'
      USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;

