-- ALL-244 / ALL-246 REVIEW ONLY. Physical Event provenance/version safety.
-- Apply after V2-EVENTHUB-IDENTITY-MEMBERSHIP-PARTICIPATION-CANDIDATE.sql.
-- No deployed EventHub owner writer, no client grants.
CREATE FUNCTION allin_private.v2_event_version_guard_candidate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $event_guard$
DECLARE
 changed boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Canonical Event identity cannot be directly deleted'
    USING ERRCODE='42501';
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
 THEN RAISE EXCEPTION 'Canonical Event identity is immutable'
   USING ERRCODE='42501'; END IF;
 changed := (
  pg_catalog.to_jsonb(NEW)-'event_version'-'updated_at'
 ) IS DISTINCT FROM (
  pg_catalog.to_jsonb(OLD)-'event_version'-'updated_at'
 );
 IF changed THEN
  IF NEW.event_version IS DISTINCT FROM OLD.event_version+1 THEN
   RAISE EXCEPTION 'Event evidence change requires exactly next version'
     USING ERRCODE='40001';
  END IF;
  NEW.updated_at:=pg_catalog.clock_timestamp();
 ELSIF NEW.event_version IS DISTINCT FROM OLD.event_version THEN
  RAISE EXCEPTION 'Event version cannot advance without changed evidence'
    USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END;
$event_guard$;
CREATE TRIGGER v2_event_version_guard
 BEFORE UPDATE OR DELETE ON public.v2_events
 FOR EACH ROW EXECUTE FUNCTION allin_private.v2_event_version_guard_candidate();
REVOKE ALL ON FUNCTION allin_private.v2_event_version_guard_candidate()
 FROM PUBLIC,anon,authenticated,service_role;
