-- ALL-251: two independent account owner/re-request isolation tests.
-- Creates only synthetic users inside a transaction which ALWAYS ROLLS BACK.
-- Not a substitute for separate authenticated client/session or live device tests.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-a@invalid.example'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-b@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','dddddddd-dddd-4ddd-8ddd-dddddddd0251');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$
declare denied boolean:=false; receipt jsonb;
begin
 begin
  perform public.v2_my_account_deletion_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL cross-account status read'; end if;
 denied:=false;
 begin
  perform public.v2_cancel_account_deletion_request(
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','dddddddd-dddd-4ddd-8ddd-dddddddd0251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL cross-account cancellation'; end if;
 denied:=false;
 begin
  perform public.v2_request_account_deletion('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','DELETE MY ACCOUNT');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL cross-account request'; end if;
 receipt:=public.v2_cancel_account_deletion_request(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'cancelled' then raise exception 'FAIL own cancellation'; end if;
 receipt:=public.v2_request_account_deletion(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','DELETE MY ACCOUNT');
 if receipt->>'status'<>'requested' or receipt->>'request_id'='cccccccc-cccc-4ccc-8ccc-cccccccc0251' then
  raise exception 'FAIL new request after cancellation did not rotate id';
 end if;
 denied:=false;
 begin
  perform public.v2_cancel_account_deletion_request(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when serialization_failure then denied:=true; end;
 if not denied then raise exception 'FAIL stale request id was allowed'; end if;
end $test$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251',true);
do $test$
declare receipt jsonb;
begin
 receipt:=public.v2_my_account_deletion_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251');
 if receipt->>'status'<>'requested' or receipt->>'request_id'<>'dddddddd-dddd-4ddd-8ddd-dddddddd0251' then
   raise exception 'FAIL other owner request was changed';
 end if;
 receipt:=public.v2_cancel_account_deletion_request(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','dddddddd-dddd-4ddd-8ddd-dddddddd0251');
 if receipt->>'status'<>'cancelled' then raise exception 'FAIL B own cancellation'; end if;
end $test$;
rollback;
