-- ALL-247 / ALL-251 REVIEW ONLY: fail-closed Fuel owner-data coverage preflight.
-- No permanent deployment. This verifies candidate FK, RLS and client ACL invariants.
-- Main account export/deletion worker integration remains the authority.
create function public.v2_fuel_privacy_preflight_review()
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v record; v_table regclass; v_checks integer:=0;
begin
 if session_user <> 'postgres' and current_user <> 'postgres' then
   raise exception 'Only review owner may call preflight' using errcode='42501';
 end if;
 for v in select * from (values
  ('public','v2_food_log_entries'),
  ('allin_private','v2_food_log_write_actions'),
  ('public','v2_hydration_events'),
  ('allin_private','v2_hydration_actions')
 ) as t(schema_name,table_name)
 loop
  v_table:=pg_catalog.to_regclass(pg_catalog.format('%I.%I',v.schema_name,v.table_name));
  if v_table is null then raise exception 'Missing Fuel table %.%',v.schema_name,v.table_name using errcode='42501'; end if;
  if not exists(select 1 from pg_catalog.pg_class c where c.oid=v_table and c.relrowsecurity) then
    raise exception 'No Fuel RLS: %',v_table using errcode='42501'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attname='user_id'
      where c.conrelid=v_table and c.contype='f' and a.attnum=any(c.conkey)
        and c.confrelid='auth.users'::regclass and c.confdeltype='c') then
    raise exception 'Owner foreign key not Auth deletion cascade: %',v_table using errcode='42501'; end if;
  if pg_catalog.has_table_privilege('anon',v_table,'INSERT')
     or pg_catalog.has_table_privilege('authenticated',v_table,'INSERT')
     or pg_catalog.has_table_privilege('authenticated',v_table,'UPDATE')
     or pg_catalog.has_table_privilege('authenticated',v_table,'DELETE') then
    raise exception 'Direct client write access on %',v_table using errcode='42501'; end if;
  v_checks:=v_checks+1;
 end loop;
 return pg_catalog.jsonb_build_object(
   'checked_owner_tables',v_checks,'auth_delete_fk','CASCADE',
   'default_owner_rls','enabled','client_table_mutations','denied',
   'export_registered',false,'deletion_worker_registered',false,
   'ready_for_release',false);
end $fn$;
revoke all on function public.v2_fuel_privacy_preflight_review()
 from public,anon,authenticated,service_role;
