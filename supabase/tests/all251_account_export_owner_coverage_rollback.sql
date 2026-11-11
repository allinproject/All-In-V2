-- ALL-251 current-schema export: two-account isolation and fail-closed coverage.
-- Synthetic Auth users only; every operation is rolled back.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-export-a@invalid.example'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-export-b@invalid.example');
update public.v2_profiles set display_name='Export owner A' where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
update public.v2_profiles set display_name='Other account B' where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$ declare payload jsonb; denied boolean:=false;
begin
 payload:=public.v2_export_my_account_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251');
 if payload->>'schema_version'<>'v2-account-export-snapshot-v1'
    or payload#>>'{profile,display_name}'<>'Export owner A'
    or payload#>>'{account,email}'<>'all251-export-a@invalid.example'
    or payload::text like '%Other account B%'
    or not(payload ? 'health_considerations') then
   raise exception 'FAIL owner export snapshot';
 end if;
 begin perform public.v2_export_my_account_snapshot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL other-account export was not rejected'; end if;
end $test$;
reset role;
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$ declare denied boolean:=false;
begin
 begin perform public.v2_export_my_account_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL stale JWT after Auth deletion'; end if;
end $test$;
rollback;

begin;
insert into auth.users(id,instance_id,aud,role,email)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all251-export-coverage@invalid.example');
create table public.v2_all251_rollback_only_uncovered_export_data(user_id uuid not null);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$ declare denied boolean:=false;
begin
 begin perform public.v2_export_my_account_snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL new owner table not covered by export'; end if;
end $test$;
rollback;
