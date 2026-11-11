-- ALL-251: completion must verify every current owner relation and Auth sessions,
-- not just auth.users and the original request. No deletion performed here.
create or replace function public.v2_record_account_deletion_completion(
 p_expected_user_id uuid,p_expected_request_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_count integer;
 v_relation record;
 v_remaining boolean;
begin
 if p_expected_user_id is null or p_expected_request_id is null then
   raise exception 'Exact completion evidence required' using errcode='22023';
 end if;
 if exists(select 1 from auth.users where id=p_expected_user_id) then
   raise exception 'Auth user still exists; completion denied' using errcode='42501';
 end if;
 if exists(select 1 from auth.sessions where user_id=p_expected_user_id) then
   raise exception 'Auth sessions still exist; completion denied' using errcode='42501';
 end if;
 if exists(select 1 from storage.buckets) then
   raise exception 'Storage coverage unverified; completion denied' using errcode='42501';
 end if;
 -- Survey all current public/private direct owner tables, not just the
 -- ones present when the worker was originally created.
 for v_relation in
   select n.nspname as schema_name,c.relname as table_name
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid
     and a.attname='user_id' and a.attnum>0 and not a.attisdropped
   where n.nspname in ('public','allin_private')
     and c.relkind in ('r','p')
     and c.oid <> 'allin_private.v2_account_deletion_execution_audit'::regclass
 loop
   execute pg_catalog.format(
     'select exists(select 1 from %I.%I where user_id=$1)',
     v_relation.schema_name,v_relation.table_name
   ) into v_remaining using p_expected_user_id;
   if v_remaining then
     raise exception 'User-owned data still exists; completion denied' using errcode='42501';
   end if;
 end loop;
 update allin_private.v2_account_deletion_execution_audit
 set status='completed',user_id=null,failure_code=null,
     completed_at=now(),updated_at=now()
 where request_id=p_expected_request_id and user_id=p_expected_user_id
   and status in ('processing','failed');
 get diagnostics v_count=row_count;
 if v_count<>1 then
   raise exception 'Matching active deletion execution not found' using errcode='40001';
 end if;
 return jsonb_build_object('status','completed','request_id',p_expected_request_id);
end;$function$;
revoke all on function public.v2_record_account_deletion_completion(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_record_account_deletion_completion(uuid,uuid) to service_role;