-- ALL-251: hard OFF switch for destructive-account-processing rollout.
-- Deletion processing is disabled by default and cannot be switched on by client
-- or service-role API credentials. Enabling requires a separate privileged,
-- reviewed database action after legal, processor, and device acceptance.
create table allin_private.v2_account_deletion_processor_config (
  singleton boolean primary key default true check (singleton),
  execution_enabled boolean not null default false,
  changed_at timestamptz not null default now(),
  change_reason text not null default 'Processor not implemented or accepted'
);
insert into allin_private.v2_account_deletion_processor_config
  (singleton,execution_enabled)
values (true,false);
alter table allin_private.v2_account_deletion_processor_config enable row level security;
revoke all on allin_private.v2_account_deletion_processor_config from public,anon,authenticated,service_role;
comment on table allin_private.v2_account_deletion_processor_config is
 'Default OFF. Separate human-controlled privileged release gate. No automated deletion worker deployed.';

create or replace function public.v2_claim_account_deletion_for_processing(
 p_expected_user_id uuid,
 p_expected_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_row allin_private.v2_account_deletion_requests%rowtype;
begin
 if p_expected_user_id is null or p_expected_request_id is null then
   raise exception 'Exact owner and request ID required' using errcode='22023';
 end if;
 if not exists (
   select 1 from allin_private.v2_account_deletion_processor_config
   where singleton=true and execution_enabled=true
 ) then
   raise exception 'Deletion processing is not enabled or accepted' using errcode='42501';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('v2-delete-request:' || p_expected_user_id::text,0)
 );
 select * into v_row
 from allin_private.v2_account_deletion_requests
 where user_id=p_expected_user_id
 for update;
 if not found or v_row.request_id is distinct from p_expected_request_id then
   raise exception 'Deletion request changed or no longer exists' using errcode='40001';
 end if;
 if v_row.status <> 'requested' then
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
