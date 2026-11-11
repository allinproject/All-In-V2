-- ALL-251: service-only completion readback after lost RPC response.
-- Real SQL against synthetic data. All writes ROLLBACK.
begin;
insert into auth.users(id,instance_id,aud,role,email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-receipt-rollback@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
do $test$ declare receipt jsonb;
begin
 receipt:=public.v2_verify_account_deletion_completion('cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'not_completed' then raise exception 'FAIL pending request verified completed'; end if;
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$ declare denied boolean:=false;
begin
 begin perform public.v2_verify_account_deletion_completion('cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL owner could read service-only audit'; end if;
end $test$;
reset role;
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,change_reason='ALL251 rollback-only verification test'
 where singleton=true and execution_enabled=false;
do $test$ declare receipt jsonb;
begin
 receipt:=public.v2_claim_account_deletion_for_processing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'processing' then raise exception 'FAIL claim'; end if;
 receipt:=public.v2_record_account_deletion_failure('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251','auth_verify_failed');
 receipt:=public.v2_verify_account_deletion_completion('cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'not_completed' then raise exception 'FAIL failed audit verified completed'; end if;
end $test$;
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
do $test$ declare receipt jsonb;
begin
 receipt:=public.v2_record_account_deletion_completion('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'completed' then raise exception 'FAIL cannot mark completion'; end if;
 receipt:=public.v2_verify_account_deletion_completion('cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'completed' or receipt->>'request_id'<>'cccccccc-cccc-4ccc-8ccc-cccccccc0251' then
  raise exception 'FAIL completed audit readback';
 end if;
 receipt:=public.v2_verify_account_deletion_completion('dddddddd-dddd-4ddd-8ddd-dddddddd0251');
 if receipt->>'status'<>'not_completed' then raise exception 'FAIL unrelated request verified complete'; end if;
end $test$;
rollback;
