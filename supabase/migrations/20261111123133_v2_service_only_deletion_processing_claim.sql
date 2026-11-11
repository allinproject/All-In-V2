-- ALL-251 V2: service-only processing claim.
-- No automatic worker, auth deletion, storage deletion, or scheduled task is enabled.
-- The existing user cancellation takes the same advisory/row locks.
create or replace function public.v2_claim_account_deletion_for_processing(
 p_expected_user_id uuid,
 p_expected_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
 v_row allin_private.v2_account_deletion_requests%rowtype;
begin
 if p_expected_user_id is null or p_expected_request_id is null then
   raise exception 'Exact owner and request ID required' using errcode='22023';
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
comment on function public.v2_claim_account_deletion_for_processing(uuid,uuid) is
 'Service-role claim only, serializes against owner cancellation. No deletion worker is connected. Do not claim until the complete authenticated and Storage deletion processor passes acceptance.';