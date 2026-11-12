-- ALL-247 review-only synthetic Auth delete cascade acceptance, always rollback.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fuel-delete-synthetic@example.invalid','',now(),now(),now());
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Test food',1,'serving',100,'user_entered');
select public.v2_hydration_mutate_manual('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','add',null,'2026-11-12 19:00+00','2026-11-12','America/Chicago','drink',250,'ml');
reset role;
do $test$
declare n int;
begin
 select count(*) into n from public.v2_food_log_entries where user_id='11111111-1111-4111-8111-111111111111';
 if n<>1 then raise exception 'Food fixture not present'; end if;
 select count(*) into n from public.v2_hydration_events where user_id='11111111-1111-4111-8111-111111111111';
 if n<>1 then raise exception 'Hydration fixture not present'; end if;
end $test$;
delete from auth.users where id='11111111-1111-4111-8111-111111111111';
do $test$
declare n int;
begin
 select count(*) into n from (
 select user_id from public.v2_food_log_entries
 union all select user_id from allin_private.v2_food_log_write_actions
 union all select user_id from public.v2_hydration_events
 union all select user_id from allin_private.v2_hydration_actions
 ) own where own.user_id='11111111-1111-4111-8111-111111111111';
 if n<>0 then raise exception 'Deleted synthetic account retains % Fuel owner rows',n; end if;
end $test$;
select 'PASS ALL-247 synthetic Auth cascade removes 4 owner-data tables' as acceptance;