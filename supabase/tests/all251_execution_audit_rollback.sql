-- ALL-251 durable deletion audit; ROLLBACK-ONLY synthetic Auth account.
-- NOT a substitute for actual service Auth Admin API, iPhone, or multi-session testing.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','all251-rollback-audit@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
do $t$
declare rejected boolean:=false;
begin
 begin
   perform public.v2_claim_account_deletion_for_processing(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'FAIL default-off gate'; end if;
end $t$;
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,change_reason='ALL-251 rollback-only audit test'
 where singleton=true and execution_enabled=false;
do $t$
declare receipt jsonb;
begin
 receipt:=public.v2_claim_account_deletion_for_processing(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'processing' then raise exception 'FAIL claim'; end if;
 if not exists(select 1 from allin_private.v2_account_deletion_execution_audit
  where request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251' and status='processing') then
   raise exception 'FAIL audit missing before delete';
 end if;
end $t$;
do $t$
declare rejected boolean:=false;
begin
 begin
   perform public.v2_record_account_deletion_completion(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'FAIL premature completion'; end if;
end $t$;
-- Simulate the effect of Auth Admin deletion in an isolated rollback only.
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
do $t$
declare receipt jsonb;
begin
 if exists(select 1 from allin_private.v2_account_deletion_requests
   where request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251') then
  raise exception 'FAIL request did not cascade';
 end if;
 receipt:=public.v2_record_account_deletion_completion(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'completed' then raise exception 'FAIL completion'; end if;
 if not exists(select 1 from allin_private.v2_account_deletion_execution_audit
  where request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251'
  and status='completed' and user_id is null and completed_at is not null) then
   raise exception 'FAIL completion proof';
 end if;
end $t$;
rollback;
