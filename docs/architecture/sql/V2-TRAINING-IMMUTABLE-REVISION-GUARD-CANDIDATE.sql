-- ALL-246 REVIEW ONLY: protect canonical accepted/superseded plan history.
-- NOT A MIGRATION. Must be reviewed alongside the plan writer and calendar.
-- Server-side triggers protect immutable history even if a trusted writer is
-- accidentally given broad UPDATE privilege later.
CREATE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
DECLARE
 v_old_status text;
 v_new_status text;
BEGIN
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
CREATE TRIGGER v2_guard_training_revision_snapshot
 BEFORE UPDATE OR DELETE ON public.v2_training_plan_revisions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate();
CREATE TRIGGER v2_guard_training_revision_days
 BEFORE INSERT OR UPDATE OR DELETE ON public.v2_training_revision_days
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate();
CREATE TRIGGER v2_guard_training_revision_sessions
 BEFORE INSERT OR UPDATE OR DELETE ON public.v2_training_revision_sessions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_training_guard_revision_snapshot_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
-- Existing plan acceptance remains the ONLY reviewed accepted->superseded
-- transition; direct authenticated UPDATE remains revoked on all tables.
