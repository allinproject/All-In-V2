-- ALL-251: manual recovery proof without a second deletion attempt.
-- Synthetic account only; all changes ROLLBACK. NEVER COMMIT.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',
'00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','all251-recovery-rollback@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,change_reason='ALL-251 rollback-only recovery test'
 where singleton=true and execution_enabled=false;
do $t$
declare v_claim jsonb;v_failed jsonb;denied boolean:=false;
begin
 v_claim:=public.v2_claim_account_deletion_for_processing(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if v_claim->>'status'<>'processing' then raise exception 'FAIL claim'; end if;
 v_failed:=public.v2_record_account_deletion_failure(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',
  'cccccccc-cccc-4ccc-8ccc-cccccccc0251','auth_verify_failed');
 if v_failed->>'status'<>'failed' then raise exception 'FAIL failure evidence'; end if;
 begin
  perform public.v2_record_account_deletion_completion(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL premature recovery when Auth exists'; end if;
end $t$;
-- Simulate independent verified Auth deletion, NOT another worker/Auth Admin call.
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
do $t$
declare v_result jsonb;
begin
 v_result:=public.v2_record_account_deletion_completion(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if v_result->>'status'<>'completed' then raise exception 'FAIL manual completion'; end if;
 if not exists(select 1 from allin_private.v2_account_deletion_execution_audit
  where request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251'
  and status='completed' and user_id is null and failure_code is null and completed_at is not null) then
   raise exception 'FAIL redacted durable completion';
 end if;
end $t$;
rollback;
