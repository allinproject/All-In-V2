-- ALL-251 rollback-only completion coverage: Auth absence is NOT enough.
-- Creates synthetic Auth and orphan rows ONLY within a transaction; ROLLBACK required.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',
'00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','all251-rollback-orphan@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,change_reason='ALL-251 rollback-only orphan test'
 where singleton=true and execution_enabled=false;
do $t$
declare receipt jsonb;
begin
 receipt:=public.v2_claim_account_deletion_for_processing(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',
 'cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'processing' then raise exception 'FAIL claim'; end if;
end $t$;
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
create table public.v2_all251_rollback_only_orphan(user_id uuid not null);
insert into public.v2_all251_rollback_only_orphan(user_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251');
do $t$
declare denied boolean:=false;
begin
 begin
  perform public.v2_record_account_deletion_completion(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',
   'cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL orphan owner row did not block completion'; end if;
end $t$;
delete from public.v2_all251_rollback_only_orphan
 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
do $t$
declare receipt jsonb;
begin
 receipt:=public.v2_record_account_deletion_completion(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',
   'cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if receipt->>'status'<>'completed' then raise exception 'FAIL completion after cleanup'; end if;
 if not exists(select 1 from allin_private.v2_account_deletion_execution_audit
 where request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251' and status='completed'
 and user_id is null) then raise exception 'FAIL durable redacted audit'; end if;
end $t$;
rollback;
