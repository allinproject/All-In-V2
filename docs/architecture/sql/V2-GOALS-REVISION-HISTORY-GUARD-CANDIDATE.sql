-- ALL-239 / ALL-222 REVIEW ONLY canonical Goal revision history.
-- Do not deploy. Load AFTER V2-GOALS-IDENTITY-REVISION-OWNER-CANDIDATE.sql.
-- SQL-level defense in depth: no in-place edits to accepted/superseded intent.
CREATE FUNCTION allin_private.v2_goal_revision_history_guard_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $goal_guard$
BEGIN
  IF TG_OP='DELETE' THEN
    -- The authenticated owner must still exist for normal delete/revise.
    -- An actual Auth account teardown may cascade immutable history, but
    -- unapproved direct table writes stay revoked from the app roles.
    IF OLD.status<>'candidate' AND EXISTS (
      SELECT 1 FROM auth.users WHERE id=OLD.user_id
    ) THEN
      RAISE EXCEPTION 'Published Goal revision cannot be deleted while owner exists'
        USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status<>'candidate' THEN
    IF OLD.status='accepted' AND NEW.status='superseded'
      AND (pg_catalog.to_jsonb(NEW)-'status') IS NOT DISTINCT FROM
          (pg_catalog.to_jsonb(OLD)-'status')
    THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Published Goal revision content cannot be modified'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$goal_guard$;
CREATE TRIGGER v2_goal_revision_guard
 BEFORE UPDATE OR DELETE ON public.v2_goal_revisions
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_goal_revision_history_guard_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_goal_revision_history_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
