-- ALL-251 REVIEW ONLY. Load after existing V2 migrations AND
-- V2-ACCOUNT-DELETION-OWNER-GRAPH-PREFLIGHT-REVIEW.sql in an isolated
-- BEGIN...ROLLBACK fixture. Never register as an applied migration until
-- external retention, Storage API cleanup and bilateral Community review.
-- No deletion is performed by this SQL.
CREATE OR REPLACE FUNCTION allin_private.v2_deletion_assert_approved_coverage_review()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE v_reason text;
BEGIN
 SELECT reason INTO v_reason FROM allin_private.v2_deletion_owner_graph_gaps_review()
 ORDER BY CASE WHEN reason='audit_retention_policy_required' THEN 2 ELSE 1 END,
          schema_name,table_name,owner_column LIMIT 1;
 IF FOUND THEN
  -- Do not expose owner IDs, table contents, or private bucket names.
  RAISE EXCEPTION 'Unapproved account deletion coverage: %',v_reason USING ERRCODE='42501';
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION allin_private.v2_deletion_assert_approved_coverage_review()
 FROM PUBLIC,anon,authenticated,service_role;

-- Exact canonical claim implementation, with one extra fail-closed review guard.
-- Existing owner/request advisory lock, status CAS, durable audit and
-- default-off worker gate are left unchanged.
create or replace function public.v2_claim_account_deletion_for_processing(
 p_expected_user_id uuid,p_expected_request_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_row allin_private.v2_account_deletion_requests%rowtype;
begin
 if p_expected_user_id is null or p_expected_request_id is null then
   raise exception 'Exact owner and request ID required' using errcode='22023';
 end if;
 if not exists (select 1 from allin_private.v2_account_deletion_processor_config
                where singleton=true and execution_enabled=true) then
   raise exception 'Deletion processing is not enabled or accepted' using errcode='42501';
 end if;
 if exists(select 1 from storage.buckets) then
   raise exception 'Deletion storage coverage not validated: buckets exist' using errcode='42501';
 end if;
 if exists (
   select 1 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname='user_id'
     and a.attnum>0 and not a.attisdropped
   where n.nspname in ('public','allin_private') and c.relkind in ('r','p')
     and c.oid <> 'allin_private.v2_account_deletion_execution_audit'::regclass
     and not exists (select 1 from pg_catalog.pg_constraint fk
       where fk.conrelid=c.oid and fk.confrelid='auth.users'::regclass
       and fk.contype='f' and fk.confdeltype='c')
 ) then
   raise exception 'Deletion owner-data cascade coverage incomplete' using errcode='42501';
 end if;
 perform allin_private.v2_deletion_assert_approved_coverage_review();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2-delete-request:'||p_expected_user_id::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests
 where user_id=p_expected_user_id for update;
 if not found or v_row.request_id is distinct from p_expected_request_id then
   raise exception 'Deletion request changed or no longer exists' using errcode='40001';
 end if;
 if v_row.status<>'requested' then
   raise exception 'Only a pending deletion request can be claimed' using errcode='42501';
 end if;
 -- Never resume an existing audit request via claim without reviewed recovery.
 if exists(select 1 from allin_private.v2_account_deletion_execution_audit
           where request_id=p_expected_request_id) then
   raise exception 'Deletion execution record already exists' using errcode='40001';
 end if;
 insert into allin_private.v2_account_deletion_execution_audit(request_id,user_id,status)
 values(p_expected_request_id,p_expected_user_id,'processing');
 update allin_private.v2_account_deletion_requests
 set status='processing',updated_at=now()
 where user_id=p_expected_user_id and request_id=p_expected_request_id and status='requested'
 returning * into v_row;
 if not found then
   raise exception 'Deletion claim failed; review state' using errcode='40001';
 end if;
 return jsonb_build_object('status',v_row.status,'user_id',v_row.user_id,
  'request_id',v_row.request_id,'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

-- Exact canonical completion implementation plus the same coverage guard.
-- Still requires Auth and session absence and full owner-row readback.
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
 perform allin_private.v2_deletion_assert_approved_coverage_review();
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
