-- ALL-251 additive staging-only owner lifecycle API candidate, REVIEW ONLY.
-- Existing ALL-251 request table is the ONE canonical request ledger.
-- Do not recreate or loosen it. Client grants are deliberately absent.
DO $safety$
BEGIN
 IF pg_catalog.to_regclass('allin_private.v2_account_deletion_requests') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review') IS NULL
 OR pg_catalog.to_regclass('allin_private.v2_account_deletion_processor_config') IS NULL
 OR NOT EXISTS(SELECT 1 FROM allin_private.v2_account_deletion_processor_config
   WHERE singleton=true AND execution_enabled=false)
 THEN RAISE EXCEPTION 'Existing ALL-251 request/lease processor OFF contract missing'
 USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regprocedure('public.v2_my_account_deletion_request(uuid)') IS NOT NULL
 OR pg_catalog.to_regprocedure('public.v2_request_account_deletion(uuid,text)') IS NOT NULL
 OR pg_catalog.to_regprocedure('public.v2_cancel_account_deletion_request(uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'Concurrent canonical owner lifecycle API exists; reconcile instead'
 USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
   WHERE tgrelid='allin_private.v2_account_deletion_requests'::pg_catalog.regclass
   AND tgname='v2_privileged_storage_write_fence_review' AND tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
   WHERE tgrelid='auth.users'::pg_catalog.regclass
   AND tgname='v2_privileged_storage_auth_delete_fence_review' AND tgenabled='O')
 THEN RAISE EXCEPTION 'Concurrent ALL-251 Storage lease fences must be active'
 USING ERRCODE='42501'; END IF;
END $safety$;

-- Canonical source supabase/migrations/20261111120805_v2_owner_verified_account_deletion_request_intake.sql blob 302dfbfa40e7078de68730628b35fc954a25e780:
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
-- Canonical source supabase/migrations/20261111121605_v2_owner_bound_deletion_request_cancel_before_processing.sql blob f171bda2d49897a89e41d30d2ece78f524c49566:
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
-- Unlike canonical mainline M9/M10 release, this staging bridge MUST NOT
-- silently activate client account-deletion actions without HTTP acceptance.
REVOKE ALL ON FUNCTION public.v2_my_account_deletion_request(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_request_account_deletion(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_cancel_account_deletion_request(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
DO $acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
 WHERE p.oid IN (
  'public.v2_my_account_deletion_request(uuid)'::pg_catalog.regprocedure,
  'public.v2_request_account_deletion(uuid,text)'::pg_catalog.regprocedure,
  'public.v2_cancel_account_deletion_request(uuid,uuid)'::pg_catalog.regprocedure
 ) AND (pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
  OR pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')))
 THEN RAISE EXCEPTION 'Staging owner lifecycle RPC exposed before HTTP acceptance'
 USING ERRCODE='42501'; END IF;
END $acl$;
