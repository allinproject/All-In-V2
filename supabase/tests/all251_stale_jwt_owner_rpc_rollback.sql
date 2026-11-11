-- ALL-251 stale JWT owner-RPC regression. ONLY synthetic Auth data; ROLLBACK required.
-- Verifies normal account access before deletion, then that nine existing owner
-- RPCs deny the same token subject after the Auth row disappears.
begin;
insert into auth.users(id,instance_id,aud,role,email)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','all251-stale-rollback@invalid.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$
begin
 if public.v2_my_profile_state() is null then
  raise exception 'FAIL active user denied profile';
 end if;
end $test$;
reset role;
delete from auth.users where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251',true);
do $test$
declare
 item record;
 denied boolean;
 n integer:=0;
begin
 for item in select * from (values
  ('profile state','select public.v2_my_profile_state()'),
  ('deletion status','select public.v2_my_account_deletion_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251')'),
  ('deletion request','select public.v2_request_account_deletion('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','DELETE MY ACCOUNT')'),
  ('health write','select public.v2_save_health_considerations('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','[]'::jsonb,'[]'::jsonb,false,0)'),
  ('settings write','select public.v2_patch_profile_settings_section('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','profile_preferences','{}'::jsonb,0,'stale-test')'),
  ('onboarding write','select public.v2_set_onboarding_step('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','focus','complete',0,'stale-test')'),
  ('legal write','select public.v2_accept_legal_documents('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','v1','v1','v1',true,'stale-test')'),
  ('health read','select public.v2_my_health_considerations('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251')'),
  ('cancel deletion','select public.v2_cancel_account_deletion_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251','cccccccc-cccc-4ccc-8ccc-cccccccc0251')')
 ) as checks(label,query_text)
 loop
  denied:=false;
  begin
   execute item.query_text;
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'FAIL stale JWT allowed: %',item.label; end if;
  n:=n+1;
 end loop;
 if n <> 9 then raise exception 'FAIL expected nine RPC tests'; end if;
end $test$;
rollback;
