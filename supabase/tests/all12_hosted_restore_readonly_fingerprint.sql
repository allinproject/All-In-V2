-- ALL-12: read-only source/recovered-target schema fingerprint.
-- Never includes athlete rows, secrets, session tokens, cron commands or Storage bytes.
-- This is a metadata comparison instrument, NOT evidence of backup or restoration.
WITH app AS (
 SELECT n.nspname || '.' || c.relname AS qualified_name,c.oid,c.relrowsecurity,
        c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','allin_private')
   AND c.relname LIKE 'v2\_%' ESCAPE '\'
),
columns AS (
 SELECT a.qualified_name,
        md5(coalesce(string_agg(format('%s:%s:%s:%s:%s',
          att.attnum,att.attname,format_type(att.atttypid,att.atttypmod),
          att.attnotnull,coalesce(pg_get_expr(def.adbin,def.adrelid),'')
        ),'|' ORDER BY att.attnum),'')) AS column_hash
 FROM app a
 JOIN pg_attribute att ON att.attrelid=a.oid AND att.attnum>0 AND NOT att.attisdropped
 LEFT JOIN pg_attrdef def ON def.adrelid=att.attrelid AND def.adnum=att.attnum
 GROUP BY a.qualified_name
),
security AS (
 SELECT a.qualified_name,
   md5(coalesce(string_agg(format('%s:%s:%s:%s',
      p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid)
   ),'|' ORDER BY p.polname),'')) AS policy_hash
 FROM app a LEFT JOIN pg_policy p ON p.polrelid=a.oid
 GROUP BY a.qualified_name
),
constraints AS (
 SELECT a.qualified_name,
  md5(coalesce(string_agg(format('%s:%s',c.conname,pg_get_constraintdef(c.oid,true)),
    '|' ORDER BY c.conname),'')) AS constraint_hash
 FROM app a LEFT JOIN pg_constraint c ON c.conrelid=a.oid
 GROUP BY a.qualified_name
),
details AS (
 SELECT a.qualified_name,a.relrowsecurity,a.relforcerowsecurity,
   r.column_hash,s.policy_hash,c.constraint_hash
 FROM app a JOIN columns r USING(qualified_name)
 JOIN security s USING(qualified_name)
 JOIN constraints c USING(qualified_name)
),
counts AS (
 SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM auth.identities) AS auth_identities,
  (SELECT count(*) FROM storage.buckets) AS storage_buckets,
  (SELECT count(*) FROM storage.objects) AS storage_objects,
  (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migrations,
  (SELECT count(*) FROM cron.job WHERE active) AS active_cron
)
SELECT jsonb_build_object(
 'postgres_version',current_setting('server_version'),
 'application_table_count',(SELECT count(*) FROM app),
 'application_schema_fingerprint',(
   SELECT md5(coalesce(string_agg(
    format('%s:%s:%s:%s:%s:%s',qualified_name,relrowsecurity,relforcerowsecurity,
      column_hash,policy_hash,constraint_hash),
    E'\n' ORDER BY qualified_name),''))
   FROM details
 ),
 'migration_ledger_fingerprint',(
   SELECT md5(coalesce(string_agg(version,'|' ORDER BY version),'')) FROM supabase_migrations.schema_migrations
 ),
 'table_security_fingerprints',(
   SELECT coalesce(jsonb_agg(jsonb_build_object('table',qualified_name,
      'rls',relrowsecurity,'force_rls',relforcerowsecurity,
      'columns_md5',column_hash,'policies_md5',policy_hash,
      'constraints_md5',constraint_hash) ORDER BY qualified_name),'[]'::jsonb)
   FROM details
 ),
 'auth_users',(SELECT auth_users FROM counts),
 'auth_identities',(SELECT auth_identities FROM counts),
 'storage_buckets',(SELECT storage_buckets FROM counts),
 'storage_objects',(SELECT storage_objects FROM counts),
 'migrations',(SELECT migrations FROM counts),
 'active_cron_jobs',(SELECT active_cron FROM counts)
) AS restore_fingerprint;
