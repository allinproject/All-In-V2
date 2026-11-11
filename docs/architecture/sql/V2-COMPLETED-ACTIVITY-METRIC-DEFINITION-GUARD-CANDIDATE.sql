-- ALL-243 REVIEW ONLY: immutable published metric semantics.
-- NOT A MIGRATION; attach to existing metric registry candidate only.
-- Metric code/version/units/applicability cannot change under older workouts.
CREATE FUNCTION allin_private.v2_activity_guard_metric_definition_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $immutable$
BEGIN
 IF TG_OP='DELETE' AND OLD.status IN ('published','retired') THEN
  RAISE EXCEPTION 'Published metric definitions cannot be deleted'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('published','retired') THEN
  RAISE EXCEPTION 'Published metric definitions are immutable'
   USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$immutable$;
CREATE TRIGGER v2_activity_guard_metric_registry
 BEFORE UPDATE OR DELETE ON public.v2_activity_metric_definitions
 FOR EACH ROW
 EXECUTE FUNCTION allin_private.v2_activity_guard_metric_definition_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_activity_guard_metric_definition_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
