-- ALL-247 manual hydration synthetic two-account acceptance; run in BEGIN/ROLLBACK.
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hyd-a@example.invalid','',now(),now(),now()),
 ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hyd-b@example.invalid','',now(),now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $accept$
declare r jsonb; qty numeric; n bigint; fills bigint;
begin
 -- A drank 500 ml (no external evidence is fabricated).
 r:=public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000001','add',null,
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','drink',500,'ml');
 if r->>'revision'<>'1' or r->>'replayed'<>'false' then raise exception 'ADD failed'; end if;
 r:=public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000001','add',null,
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','drink',500,'ml');
 if r->>'revision'<>'1' or r->>'replayed'<>'true' then raise exception 'REPLAY failed'; end if;
 begin
 perform public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000001','add',null,
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','drink',600,'ml');
 raise exception 'reused action accepted different payload';
 exception when sqlstate '22000' then null; end;
 select drink_count,confirmed_drink_ml into n,qty from public.v2_hydration_daily_history('2026-11-12','2026-11-12');
 if n<>1 or qty<>500 then raise exception 'initial daily total wrong: %, %',n,qty; end if;
 -- Refill is not consumption, and won't inflate intake.
 perform public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002',
 'b0000000-0000-4000-8000-000000000002','add',null,
 '2026-11-12 19:00+00','2026-11-12','America/Chicago','refill',1000,'ml');
 select drink_count,refill_count,confirmed_drink_ml into n,fills,qty from public.v2_hydration_daily_history('2026-11-12','2026-11-12');
 if n<>1 or fills<>1 or qty<>500 then raise exception 'refill incorrectly counted: %, %, %',n,fills,qty; end if;
 -- Edit 500ml to exactly 1 US fl oz. Original unit remains distinct.
 r:=public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003',
 'b0000000-0000-4000-8000-000000000001','edit',1,
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','drink',1,'us_fl_oz');
 select confirmed_drink_ml into qty from public.v2_hydration_daily_history('2026-11-12','2026-11-12');
 if qty <> 29.574 then raise exception 'fl oz conversion wrong: %',qty; end if;
 begin
 perform public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000004',
 'b0000000-0000-4000-8000-000000000001','edit',1,
 '2026-11-12 18:00+00','2026-11-12','America/Chicago','drink',3,'us_fl_oz');
 raise exception 'stale revision allowed';
 exception when sqlstate '40001' then null; end;
 -- Move to next day; only target day gains drinking and original keeps refill only.
 r:=public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000005',
 'b0000000-0000-4000-8000-000000000001','move',2,
 '2026-11-13 18:00+00','2026-11-13','America/Chicago','drink',1,'us_fl_oz');
 select drink_count,refill_count,confirmed_drink_ml into n,fills,qty from public.v2_hydration_daily_history('2026-11-12','2026-11-12');
 if n<>0 or fills<>1 or qty is not null then raise exception 'old day bad after move'; end if;
 select drink_count,confirmed_drink_ml into n,qty from public.v2_hydration_daily_history('2026-11-13','2026-11-13');
 if n<>1 or qty<>29.574 then raise exception 'destination day bad'; end if;
 begin
 perform public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000006',
 'b0000000-0000-4000-8000-000000000001','move',3,
 '2026-11-13 18:00+00','2026-11-13','America/Chicago','drink',2,'us_fl_oz');
 raise exception 'move changed volume';
 exception when sqlstate '22023' then null; end;
 begin
 perform public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000007',
 'b0000000-0000-4000-8000-000000000001','edit',3,
 '2026-11-13 18:00+00','2026-11-12','America/Chicago','drink',1,'us_fl_oz');
 raise exception 'inconsistent timezone/date allowed';
 exception when sqlstate '22023' then null; end;
 -- Delete, replay delete and reject second deletion.
 r:=public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000008',
 'b0000000-0000-4000-8000-000000000001','delete',3);
 if r->>'revision'<>'4' then raise exception 'delete revision'; end if;
 r:=public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000008',
 'b0000000-0000-4000-8000-000000000001','delete',3);
 if r->>'revision'<>'4' or r->>'replayed'<>'true' then raise exception 'delete replay'; end if;
 select count(*) into n from public.v2_hydration_daily_history('2026-11-13','2026-11-13');
 if n<>0 then raise exception 'deleted day shown as 0 consumed'; end if;
 select count(*) into n from public.v2_hydration_events where id='b0000000-0000-4000-8000-000000000001';
 if n<>0 then raise exception 'tombstone visible'; end if;
 begin
 perform public.v2_hydration_mutate_manual(
 '11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000009',
 'b0000000-0000-4000-8000-000000000001','delete',4);
 raise exception 'second delete allowed';
 exception when sqlstate '40001' then null; end;
 begin
 perform public.v2_hydration_mutate_manual(
 '22222222-2222-4222-8222-222222222222','a0000000-0000-4000-8000-000000000010',
 'b0000000-0000-4000-8000-000000000002','delete',1);
 raise exception 'expected actor mismatch accepted';
 exception when sqlstate '42501' then null; end;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 select count(*) into n from public.v2_hydration_events;
 if n<>0 then raise exception 'B sees A hydration'; end if;
 select count(*) into n from public.v2_hydration_daily_history('2026-11-12','2026-11-13');
 if n<>0 then raise exception 'B sees A history'; end if;
 begin
 perform public.v2_hydration_mutate_manual(
 '22222222-2222-4222-8222-222222222222','a0000000-0000-4000-8000-000000000011',
 'b0000000-0000-4000-8000-000000000002','delete',1);
 raise exception 'B could delete A refill';
 exception when sqlstate 'P0002' then null; end;
end $accept$;
reset role;
select 'PASS ALL-247 HYDRATION: add/replay/conflict, refill exclusion, unit conversion, edit/move/delete, stale revision, timezone, tombstone, account isolation' as acceptance;
