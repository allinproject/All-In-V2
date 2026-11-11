-- ALL-251: conservative deletion processing coverage checks.
-- Only for explicitly approved isolated/test V2 databases.
-- This script changes the processor switch and creates synthetic schema/storage
-- objects INSIDE transactions that are fully rolled back. Never COMMIT.
-- No real user, request, file or Auth record is modified.
begin;
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,changed_at=now(),change_reason='ALL-251 rollback-only storage test'
 where singleton=true and execution_enabled=false;
insert into storage.buckets (id,name,public)
 values ('all251-rollback-only-coverage','all251-rollback-only-coverage',false);
do $test$
declare rejected boolean := false;
begin
 begin
  perform public.v2_claim_account_deletion_for_processing(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'FAIL: new Storage bucket did not prevent processing'; end if;
end $test$;
rollback;

begin;
update allin_private.v2_account_deletion_processor_config
 set execution_enabled=true,changed_at=now(),change_reason='ALL-251 rollback-only owner-data test'
 where singleton=true and execution_enabled=false;
create table public.v2_all251_rollback_only_uncascaded_user_data(user_id uuid not null);
do $test$
declare rejected boolean := false;
begin
 begin
  perform public.v2_claim_account_deletion_for_processing(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'FAIL: uncascaded owner data did not prevent processing'; end if;
end $test$;
rollback;
