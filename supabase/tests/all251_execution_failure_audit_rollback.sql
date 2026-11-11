-- ALL-251 failed-erasure evidence: rollback-only, never a real account.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','all251-rollback-fail@invalid.example');
insert into allin_private.v2_account_deletion_requests(user_id,request_id)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,change_reason='ALL-251 rollback test only'
 where singleton=true and execution_enabled=false;
do $t$
declare v_claim jsonb;v_fail jsonb;denied boolean:=false;
begin
 v_claim:=public.v2_claim_account_deletion_for_processing(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 if v_claim->>'status'<>'processing' then raise exception 'FAIL claim'; end if;
 v_fail:=public.v2_record_account_deletion_failure(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251','auth_delete_failed');
 if v_fail->>'status'<>'failed' then raise exception 'FAIL failure receipt'; end if;
 if not exists(select 1 from allin_private.v2_account_deletion_execution_audit
  where request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251'
  and status='failed' and failure_code='auth_delete_failed'
  and user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251') then
   raise exception 'FAIL failure audit';
 end if;
 begin
  perform public.v2_record_account_deletion_failure(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251','arbitrary_data');
 exception when invalid_parameter_value then denied:=true;
 end;
 if not denied then raise exception 'FAIL invalid failure reason allowed'; end if;
end $t$;
rollback;
