-- ALL-251: V2-only deterministic processing-claim versus cancellation ordering.
-- ONLY run in the intended isolated/test V2 environment. Inserts two synthetic
-- Auth users and deletion requests within a transaction then ROLLS BACK all writes.
-- Assertions signal SQL exceptions on failure. Never COMMIT this script.
-- This proves ordering and CAS guards; it does NOT prove a truly concurrent two-session race.
begin;
insert into auth.users (id, instance_id, aud, role, email)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rollback-claim-first@invalid.example'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rollback-cancel-first@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','dddddddd-dddd-4ddd-8ddd-dddddddd0251');
do $test$
declare receipt jsonb;
begin
 receipt := public.v2_claim_account_deletion_for_processing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status' <> 'processing' then raise exception 'FAIL claim-first'; end if;
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$
declare rejected boolean := false;
begin
 begin
  perform public.v2_cancel_account_deletion_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then rejected := true;
 end;
 if not rejected then raise exception 'FAIL: processing request was cancellable'; end if;
end $test$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251',true);
do $test$
declare receipt jsonb;
begin
 receipt := public.v2_cancel_account_deletion_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','dddddddd-dddd-4ddd-8ddd-dddddddd0251');
 if receipt->>'status' <> 'cancelled' then raise exception 'FAIL cancellation-first'; end if;
end $test$;
reset role;
do $test$
declare rejected boolean := false;
begin
 begin
  perform public.v2_claim_account_deletion_for_processing('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','dddddddd-dddd-4ddd-8ddd-dddddddd0251');
 exception when insufficient_privilege then rejected := true;
 end;
 if not rejected then raise exception 'FAIL: cancelled request was claimable'; end if;
end $test$;
rollback;
