-- ALL-247/ALL-251 rollback-only fragment contract. Requires prerequisite review SQL.
-- The grant below exists only in this single rolled-back test transaction.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','export-a@example.invalid','',now(),now(),now()),
 ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','export-b@example.invalid','',now(),now(),now());
grant execute on function public.v2_account_export_fuel_fragment_review(uuid) to authenticated;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare f jsonb; n int;
begin
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Test food',1,'serving',null,'unknown');
 perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001',1,'delete');
 perform public.v2_hydration_mutate_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002','add',null,'2026-11-12 19:00+00','2026-11-12','America/Chicago','drink',400,'ml');
 f:=public.v2_account_export_fuel_fragment_review('11111111-1111-4111-8111-111111111111');
 if jsonb_array_length(f->'food_entries')<>1 or jsonb_array_length(f->'food_actions')<>2 or
    jsonb_array_length(f->'hydration_events')<>1 or jsonb_array_length(f->'hydration_actions')<>1 or
    f#>>'{food_entries,0,deleted_at}' is null then
    raise exception 'Fuel export missing tombstone or receipts: %',f;
 end if;
 begin
  perform public.v2_account_export_fuel_fragment_review('22222222-2222-4222-8222-222222222222');
  raise exception 'Foreign account export allowed';
 exception when sqlstate '42501' then null; end;
 perform pg_catalog.set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 f:=public.v2_account_export_fuel_fragment_review('22222222-2222-4222-8222-222222222222');
 if jsonb_array_length(f->'food_entries')<>0 or jsonb_array_length(f->'hydration_events')<>0 then
  raise exception 'User B saw User A Fuel: %',f; end if;
end $test$;
reset role;
select 'PASS ALL-247 export: tombstones+receipts, cross-account denial, no owner B leak' as acceptance;