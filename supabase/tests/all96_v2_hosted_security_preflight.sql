-- ALL-96 / ALL-222: read-only hosted security gate, PostgreSQL 17.
-- No DDL or privilege changes. Inspect current client-role permissions.
DO $audit$
DECLARE problem text;
BEGIN
 SELECT string_agg(format('%I.%I',n.nspname,c.relname),', ' ORDER BY n.nspname,c.relname)
 INTO problem
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND c.relname LIKE 'v2_%' AND NOT c.relrowsecurity;
 IF problem IS NOT NULL THEN
  RAISE EXCEPTION 'ALL-96 exposed V2 tables missing RLS: %',problem;
 END IF;
 SELECT string_agg(format('%I.%I(%s)',n.nspname,p.proname,
  pg_get_function_identity_arguments(p.oid)),', ' ORDER BY p.proname)
 INTO problem
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='allin_private'
 AND (has_function_privilege('anon',p.oid,'EXECUTE')
 OR has_function_privilege('authenticated',p.oid,'EXECUTE'));
 IF problem IS NOT NULL THEN
  RAISE EXCEPTION 'ALL-96 private functions executable by client roles: %',problem;
 END IF;
 RAISE NOTICE 'PASS ALL-96: V2 public table RLS and private function client grants';
END $audit$;
