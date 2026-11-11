-- ALL-251: durable minimal deletion evidence, separate from Auth-cascaded request.
-- Service-only functions; no automation, key exposure or erasure enabled.
create table allin_private.v2_account_deletion_execution_audit (
  request_id uuid primary key,
  user_id uuid,
  status text not null check (status in ('processing','failed','completed')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_code text check (failure_code in ('auth_delete_failed','auth_verify_failed','completion_failed')),
  constraint v2_deletion_audit_completion check (
    (status='completed' and completed_at is not null and user_id is null and failure_code is null)
    or (status<>'completed' and completed_at is null and user_id is not null)
  )
);
alter table allin_private.v2_account_deletion_execution_audit enable row level security;
revoke all on allin_private.v2_account_deletion_execution_audit from public,anon,authenticated,service_role;
comment on table allin_private.v2_account_deletion_execution_audit is
 'Minimal request-ID completion/failure evidence surviving Auth cascade. Retention, operator response and future worker require privacy signoff. Never store email/messages/tokens.';

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

create function public.v2_record_account_deletion_failure(
 p_expected_user_id uuid,p_expected_request_id uuid,p_failure_code text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_count integer;
begin
 if p_expected_user_id is null or p_expected_request_id is null
 or p_failure_code not in ('auth_delete_failed','auth_verify_failed','completion_failed')
 or p_failure_code is null then
   raise exception 'Invalid deletion failure evidence' using errcode='22023';
 end if;
 update allin_private.v2_account_deletion_execution_audit
 set status='failed',failure_code=p_failure_code,updated_at=now()
 where request_id=p_expected_request_id and user_id=p_expected_user_id
   and status in ('processing','failed');
 get diagnostics v_count=row_count;
 if v_count<>1 then
   raise exception 'No matching active deletion execution' using errcode='40001';
 end if;
 return jsonb_build_object('status','failed','request_id',p_expected_request_id);
end;$function$;

create function public.v2_record_account_deletion_completion(
 p_expected_user_id uuid,p_expected_request_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_count integer;
begin
 if p_expected_user_id is null or p_expected_request_id is null then
  raise exception 'Exact completion evidence required' using errcode='22023';
 end if;
 -- The Auth row and cascaded owner records must truly be gone before success.
 if exists(select 1 from auth.users where id=p_expected_user_id) then
   raise exception 'Auth user still exists; completion denied' using errcode='42501';
 end if;
 if exists(
   select 1 from allin_private.v2_account_deletion_requests
    where user_id=p_expected_user_id
 ) then
   raise exception 'Deletion request still exists; completion denied' using errcode='42501';
 end if;
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

revoke all on function public.v2_claim_account_deletion_for_processing(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_claim_account_deletion_for_processing(uuid,uuid) to service_role;
revoke all on function public.v2_record_account_deletion_failure(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_record_account_deletion_failure(uuid,uuid,text) to service_role;
revoke all on function public.v2_record_account_deletion_completion(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_record_account_deletion_completion(uuid,uuid) to service_role;
