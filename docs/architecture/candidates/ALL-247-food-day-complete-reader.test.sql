-- ALL-247: synthetic two-account, complete canonical Food Log day regression.
-- Run after all three Food review SQL candidates within BEGIN/ROLLBACK.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
 values ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','food-day-a@example.invalid','',now(),now(),now()),
 ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','food-day-b@example.invalid','',now(),now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare a jsonb; b jsonb; c jsonb; d jsonb;
begin
 a:=public.v2_food_log_read_complete_day('11111111-1111-4111-8111-111111111111','2026-11-12');
 if a->>'complete'<>'true' or pg_catalog.jsonb_array_length(a->'entries')<>0
   or a->>'sourceRevision' not like 'fuel-food-day-v1:%' then raise exception 'Empty day not verifiably complete: %',a; end if;
 perform public.v2_food_log_add_manual(
 '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Lunch',1,'serving',700,'user_entered');
 b:=public.v2_food_log_read_complete_day('11111111-1111-4111-8111-111111111111','2026-11-12');
 if pg_catalog.jsonb_array_length(b->'entries')<>1 or b#>>'{entries,0,label}'<>'Lunch'
   or b#>>'{entries,0,user_id}'<>'11111111-1111-4111-8111-111111111111'
   or a->>'sourceRevision'=b->>'sourceRevision' then raise exception 'Add not visible in full day: %',b; end if;
 perform public.v2_food_log_mutate_manual(
 '11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'edit','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Updated lunch',1,'serving',750,'user_entered');
 c:=public.v2_food_log_read_complete_day('11111111-1111-4111-8111-111111111111','2026-11-12');
 if c#>>'{entries,0,label}'<>'Updated lunch' or c#>>'{entries,0,revision}'<>'2'
   or c->>'sourceRevision'=b->>'sourceRevision' then raise exception 'Edit not reflected: %',c; end if;
 perform public.v2_food_log_mutate_manual(
 '11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2,'delete');
 d:=public.v2_food_log_read_complete_day('11111111-1111-4111-8111-111111111111','2026-11-12');
 if pg_catalog.jsonb_array_length(d->'entries')<>0 or d->>'sourceRevision'=c->>'sourceRevision' then
  raise exception 'Tombstone still visible or no revision change: %',d; end if;
 begin
  perform public.v2_food_log_read_complete_day('22222222-2222-4222-8222-222222222222','2026-11-12');
  raise exception 'Cross-owner read accepted';
 exception when sqlstate '42501' then null; end;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 a:=public.v2_food_log_read_complete_day('22222222-2222-4222-8222-222222222222','2026-11-12');
 if pg_catalog.jsonb_array_length(a->'entries')<>0 then raise exception 'B can see A entries'; end if;
end $test$;
reset role;
-- 257 synthetic active events must be rejected, never a "complete" 256-row preview.
insert into public.v2_food_log_entries
 (id,user_id,consumed_at,local_date,timezone_name,meal_slot,label,quantity,unit,kcal,nutrition_source)
select ('11111111-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,
 '11111111-1111-4111-8111-111111111111'::uuid,
 '2026-11-13 18:00+00'::timestamptz+i*interval '1 second',
 '2026-11-13','America/Chicago','snack','Test row',1,'each',null,'unknown'
 from pg_catalog.generate_series(1,257) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$ begin
 begin
  perform public.v2_food_log_read_complete_day('11111111-1111-4111-8111-111111111111','2026-11-13');
  raise exception 'Truncated 257-row day claimed complete';
 exception when sqlstate '54000' then null; end;
end $test$;
reset role;
select 'PASS ALL-247 complete day: add/edit/delete revision, owner isolation, oversized day refusal' as acceptance;