insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hardener@example.invalid','',now(),now(),now());
do $test$
begin
 if pg_catalog.has_function_privilege('authenticated','public.v2_account_export_fuel_fragment_review(uuid)','execute') then
  raise exception 'Export fragment callable by authenticated';
 end if;
 if pg_catalog.has_function_privilege('anon','public.v2_account_export_fuel_fragment_review(uuid)','execute') then
  raise exception 'Export fragment callable by anon';
 end if;
 if pg_catalog.has_table_privilege('authenticated','public.v2_food_log_entries','update') then
  raise exception 'Direct food write allowed';
 end if;
end $test$;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
begin
 begin
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','2026-11-12 18:00+00','2026-11-12','Fake/Zone','lunch','Meal',1,'serving',100,'user_entered');
 raise exception 'Invalid timezone accepted';
 exception when sqlstate '22023' then null; end;
 begin
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Meal',1,'serving',null,'user_entered');
 raise exception 'Unsubstantiated user-entered energy accepted';
 exception when sqlstate '22023' then null; end;
end $test$;
reset role;
select 'PASS ALL-247: invalid timezone and provenance denied; ACL protected' as acceptance;