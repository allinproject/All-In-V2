-- ALL-251: fail-closed deletion coverage preflight, even if processor rollout is later enabled.
-- Future V2 Storage buckets or user-owned domain tables without cascade coverage
-- must be consciously supported before processing any request.
create or replace function public.v2_claim_account_deletion_for_processing(
 p_expected_user_id uuid, p_expected_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
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
 -- This is intentionally conservative; future private photo or other buckets
 -- require a reviewed, owner-scoped storage cleanup implementation first.
 if exists(select 1 from storage.buckets) then
   raise exception 'Deletion storage coverage not validated: buckets exist' using errcode='42501';
 end if;
 -- Detect new directly user-owned V2 tables that would not be removed by Auth cascade.
 if exists (
   select 1
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid
     and a.attname='user_id' and a.attnum>0 and not a.attisdropped
   where n.nspname in ('public','allin_private') and c.relkind in ('r','p')
     and not exists (
       select 1 from pg_catalog.pg_constraint fk
       where fk.conrelid=c.oid
         and fk.confrelid='auth.users'::regclass
         and fk.contype='f' and fk.confdeltype='c'
     )
 ) then
   raise exception 'Deletion owner-data cascade coverage incomplete' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v2-delete-request:'||p_expected_user_id::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests
 where user_id=p_expected_user_id for update;
 if not found or v_row.request_id is distinct from p_expected_request_id then
   raise exception 'Deletion request changed or no longer exists' using errcode='40001';
 end if;
 if v_row.status<>'requested' then
   raise exception 'Only a pending deletion request can be claimed' using errcode='42501';
 end if;
 update allin_private.v2_account_deletion_requests
 set status='processing',updated_at=now()
 where user_id=p_expected_user_id and request_id=p_expected_request_id and status='requested'
 returning * into v_row;
 if not found then
   raise exception 'Deletion claim failed; review state' using errcode='40001';
 end if;
 return jsonb_build_object('status',v_row.status,'user_id',v_row.user_id,
  'request_id',v_row.request_id,'requested_at',v_row.requested_at,
  'updated_at',v_row.updated_at);
end;$function$;
revoke all on function public.v2_claim_account_deletion_for_processing(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_claim_account_deletion_for_processing(uuid,uuid)
 to service_role;