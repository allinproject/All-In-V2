-- V2-only deletion request intake. No automatic user/data deletion is authorized by this migration.
create table allin_private.v2_account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null unique default gen_random_uuid(),
  status text not null default 'requested' check (status in ('requested','processing','completed','rejected')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint v2_account_delete_resolved_consistency check (
    (status in ('requested','processing') and resolved_at is null)
    or (status in ('completed','rejected') and resolved_at is not null)
  )
);
alter table allin_private.v2_account_deletion_requests enable row level security;
revoke all on allin_private.v2_account_deletion_requests from public,anon,authenticated,service_role;
comment on table allin_private.v2_account_deletion_requests is
 'V2 owner deletion request intake only. No worker or automatic destructive operation is enabled. Admin processing pending separate tested approval.';

create function public.v2_my_account_deletion_request(p_expected_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_account_deletion_requests%rowtype;
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Account deletion request requires the active user' using errcode='42501';
 end if;
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user;
 if not found then
  return jsonb_build_object('status','none');
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

create function public.v2_request_account_deletion(p_expected_user_id uuid, p_confirm text)
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
 perform pg_advisory_xact_lock(hashtextextended('v2-delete-request:'||v_user::text,0));
 select * into v_row from allin_private.v2_account_deletion_requests where user_id=v_user for update;
 if not found then
   insert into allin_private.v2_account_deletion_requests(user_id) values(v_user)
    returning * into v_row;
 elsif v_row.status='rejected' then
   update allin_private.v2_account_deletion_requests
   set status='requested', requested_at=now(), updated_at=now(), resolved_at=null,
       request_id=gen_random_uuid()
   where user_id=v_user returning * into v_row;
 end if;
 return jsonb_build_object('status',v_row.status,'request_id',v_row.request_id,
   'requested_at',v_row.requested_at,'updated_at',v_row.updated_at);
end;$function$;

revoke all on function public.v2_my_account_deletion_request(uuid) from public,anon,authenticated,service_role;
grant execute on function public.v2_my_account_deletion_request(uuid) to authenticated;
revoke all on function public.v2_request_account_deletion(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.v2_request_account_deletion(uuid,text) to authenticated;
