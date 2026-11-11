-- V2-only request lifecycle. No automatic data or auth deletion.
alter table allin_private.v2_account_deletion_requests
 drop constraint v2_account_deletion_requests_status_check;
alter table allin_private.v2_account_deletion_requests
 add constraint v2_account_deletion_requests_status_check
 check(status in ('requested','processing','completed','rejected','cancelled'));
alter table allin_private.v2_account_deletion_requests
 drop constraint v2_account_delete_resolved_consistency;
alter table allin_private.v2_account_deletion_requests
 add constraint v2_account_delete_resolved_consistency check (
 (status in ('requested','processing') and resolved_at is null)
 or (status in ('completed','rejected','cancelled') and resolved_at is not null));
create or replace function public.v2_request_account_deletion(p_expected_user_id uuid, p_confirm text)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_account_deletion_requests%rowtype;
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Account deletion request requires the active user' using errcode='42501';
 end if;
 if p_confirm is distinct from 'DELETE MY ACCOUNT' then
  raise exception 'Explicit deletion request confirmation required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2-delete-request:'||v_user::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user for update;
 if not found then
   insert into allin_private.v2_account_deletion_requests(user_id) values(v_user)
    returning * into v_row;
 elsif v_row.status in ('rejected','cancelled') then
   update allin_private.v2_account_deletion_requests
   set status='requested', requested_at=now(), updated_at=now(), resolved_at=null,
       request_id=gen_random_uuid()
   where user_id=v_user returning * into v_row;
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

create function public.v2_cancel_account_deletion_request(p_expected_user_id uuid, p_expected_request_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_account_deletion_requests%rowtype;
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Account deletion request requires the active user' using errcode='42501';
 end if;
 if p_expected_request_id is null then
  raise exception 'Expected deletion request identifier required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2-delete-request:'||v_user::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user for update;
 if not found or v_row.request_id is distinct from p_expected_request_id then
  raise exception 'Deletion request changed; reload status' using errcode='40001';
 end if;
 if v_row.status='requested' then
   update allin_private.v2_account_deletion_requests
   set status='cancelled',resolved_at=now(),updated_at=now()
   where user_id=v_user and request_id=p_expected_request_id and status='requested'
   returning * into v_row;
 elsif v_row.status<>'cancelled' then
   raise exception 'Deletion has progressed and cannot be cancelled here' using errcode='42501';
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;
revoke all on function public.v2_cancel_account_deletion_request(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.v2_cancel_account_deletion_request(uuid,uuid) to authenticated;
