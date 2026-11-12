-- ALL-247 repeatable lifecycle regression. Execute with first-writer.review.sql
-- followed by lifecycle.review.sql in one BEGIN/ROLLBACK on disposable staging only.
-- Never use a real account. Fixtures intentionally do not commit.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all247-a@example.invalid','',now(),now(),now()),
 ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','all247-b@example.invalid','',now(),now(),now());
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $accept$
declare
 v jsonb; n bigint; k numeric; missing bigint;
begin
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111',
 'a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Rice',100,'g',200,'user_entered');
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111',
 'a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002',
 '2026-11-12 20:00+00','2026-11-12','America/Chicago','snack','Banana',1,'each',100,'user_entered');
 select entry_count,known_kcal_subtotal into n,k from public.v2_food_log_day_subtotals('2026-11-12','2026-11-12');
 if n<>2 or k<>300 then raise exception 'initial subtotal incorrect'; end if;
 v:=public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
 1,'edit','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Rice',125,'g',250,'user_entered');
 if v->>'revision'<>'2' or v->>'replayed'<>'false' then raise exception 'edit version'; end if;
 v:=public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
 1,'edit','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Rice',125,'g',250,'user_entered');
 if v->>'replayed'<>'true' or v->>'revision'<>'2' then raise exception 'exact edit replay'; end if;
 begin
  perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
  'c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
  1,'edit','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Rice',200,'g',400,'user_entered');
  raise exception 'changed retry accepted';
 exception when sqlstate '22000' then null; end;
 begin
  perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
  'c0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001',
  1,'edit','2026-11-12 18:00+00','2026-11-12','America/Chicago','lunch','Rice',200,'g',400,'user_entered');
  raise exception 'stale revision accepted';
 exception when sqlstate 'PT409' then null; end;
 v:=public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002',
 1,'move','2026-11-13 20:00+00','2026-11-13','America/Chicago','snack','Banana',1,'each',100,'user_entered');
 select entry_count,known_kcal_subtotal into n,k from public.v2_food_log_day_subtotals('2026-11-12','2026-11-12');
 if n<>1 or k<>250 then raise exception 'origin subtotal did not update'; end if;
 select entry_count,known_kcal_subtotal into n,k from public.v2_food_log_day_subtotals('2026-11-13','2026-11-13');
 if n<>1 or k<>100 then raise exception 'destination subtotal did not update'; end if;
 begin
  perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
  'c0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000002',
  2,'move','2026-11-13 20:00+00','2026-11-13','America/Chicago','snack','Banana',2,'each',200,'user_entered');
  raise exception 'move changed nutrition';
 exception when sqlstate '22023' then null; end;
 v:=public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000002',2,'delete');
 if v->>'revision'<>'3' then raise exception 'delete revision'; end if;
 v:=public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000002',2,'delete');
 if v->>'replayed'<>'true' then raise exception 'delete replay'; end if;
 select count(*) into n from public.v2_food_log_day_subtotals('2026-11-13','2026-11-13');
 if n<>0 then raise exception 'deleted day should not show 0-kcal row'; end if;
 select count(*) into n from public.v2_food_log_entries where id='b0000000-0000-4000-8000-000000000002';
 if n<>0 then raise exception 'owner can see deleted tombstone'; end if;
 begin
  perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
  'c0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000002',3,'delete');
  raise exception 'double delete accepted';
 exception when sqlstate 'PT409' then null; end;
 -- Explicit unknown vs zero: both an unknown and a real zero entry.
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111',
 'a0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000003',
 '2026-11-12 21:00+00','2026-11-12','America/Chicago','snack','Unknown food',1,'each',null,'unknown');
 perform public.v2_food_log_add_manual('11111111-1111-4111-8111-111111111111',
 'a0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000004',
 '2026-11-12 22:00+00','2026-11-12','America/Chicago','snack','Zero calories',1,'each',0,'user_entered');
 select known_kcal_subtotal,unknown_kcal_count into k,missing
 from public.v2_food_log_day_subtotals('2026-11-12','2026-11-12');
 if k<>250 or missing<>1 then raise exception 'zero/unknown conflated'; end if;
 begin
  perform public.v2_food_log_mutate_manual('22222222-2222-4222-8222-222222222222',
  'c0000000-0000-4000-8000-000000000007','b0000000-0000-4000-8000-000000000001',2,'delete');
  raise exception 'cross-account expected owner accepted';
 exception when sqlstate '42501' then null; end;
 perform pg_catalog.set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 select count(*) into n from public.v2_food_log_entries;
 if n<>0 then raise exception 'B read A food'; end if;
 select count(*) into n from public.v2_food_log_day_subtotals('2026-11-12','2026-11-13');
 if n<>0 then raise exception 'B read A subtotals'; end if;
 begin
  perform public.v2_food_log_mutate_manual('22222222-2222-4222-8222-222222222222',
  'c0000000-0000-4000-8000-000000000008','b0000000-0000-4000-8000-000000000001',2,'delete');
  raise exception 'B mutated A food';
 exception when sqlstate 'P0002' then null; end;
 perform pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000009','b0000000-0000-4000-8000-000000000001',2,'delete');
 perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000003',1,'delete');
 perform public.v2_food_log_mutate_manual('11111111-1111-4111-8111-111111111111',
 'c0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000004',1,'delete');
 select count(*) into n from public.v2_food_log_day_subtotals('2026-11-12','2026-11-13');
 if n<>0 then raise exception 'empty day appears as zero consumption'; end if;
end $accept$;
reset role;
select 'PASS ALL-247 lifecycle: edit, replay, move, delete, tombstone privacy, zero/null, day subtotals, account isolation' as acceptance;
