-- ALL-251: recover a lost completion RPC response by reading only minimal
-- completed evidence. No user ID, email or other personal data is exposed.
create function public.v2_verify_account_deletion_completion(p_expected_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare v_completed boolean;
begin
 if p_expected_request_id is null then
  raise exception 'Exact deletion request identifier required' using errcode='22023';
 end if;
 select exists(
   select 1
   from allin_private.v2_account_deletion_execution_audit a
   where a.request_id=p_expected_request_id
     and a.status='completed'
     and a.user_id is null
     and a.failure_code is null
     and a.completed_at is not null
 ) into v_completed;
 return jsonb_build_object('status',case when v_completed then 'completed' else 'not_completed' end,
   'request_id',p_expected_request_id);
end;$function$;
revoke all on function public.v2_verify_account_deletion_completion(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_verify_account_deletion_completion(uuid) to service_role;
comment on function public.v2_verify_account_deletion_completion(uuid) is
 'Service-only non-PII confirmation evidence for loss of the completion RPC response. Does not delete anything.';