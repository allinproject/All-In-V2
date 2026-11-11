-- ALL-217 / ALL-222: ISOLATED PostgreSQL OWNER/RLS/ATOMICITY REPLAY.
-- Runs ONLY after applying the proposed Coach owner SQL on a disposable V2-like DB.
-- Synthetic users, threads, messages and claims are rolled back.
-- This script is source only; no live database verification is claimed.
begin;

insert into auth.users
 (id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
values
 ('aa11aa11-1111-4111-8111-111111111111','authenticated','authenticated','coach-v2-a@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now(),false),
 ('bb22bb22-2222-4222-8222-222222222222','authenticated','authenticated','coach-v2-b@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now(),false);

set local role authenticated;
select set_config('request.jwt.claim.sub','aa11aa11-1111-4111-8111-111111111111',true);

select public.v2_coach_create_thread(
 'aa11aa11-1111-4111-8111-111111111111',
 'cc33cc33-3333-4333-8333-333333333333'
);
select public.v2_coach_create_thread(
 'aa11aa11-1111-4111-8111-111111111111',
 'cc88cc88-8888-4888-8888-888888888888'
);

do $a$
begin
  if not exists(select 1 from public.v2_coach_threads
    where user_id='aa11aa11-1111-4111-8111-111111111111') then
    raise exception 'A cannot read its thread';
  end if;
  begin
    insert into public.v2_coach_messages
    (id,user_id,thread_id,client_request_id,role,content)
    values('dd44dd44-4444-4444-8444-444444444444',
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    'ee55ee55-5555-4555-8555-555555555555','assistant','fake response');
    raise exception 'Authenticated client bypassed server-only Coach writer';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.v2_coach_append_exchange(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      'ee55ee55-5555-4555-8555-555555555555',
      'dd44dd44-4444-4444-8444-444444444444',
      'ff66ff66-6666-4666-8666-666666666666',1,'hello','fake');
    raise exception 'Authenticated client executed server-only exchange RPC';
  exception when insufficient_privilege then null;
  end;
end;
$a$;

-- B cannot read, replay, or create an existing A thread.
select set_config('request.jwt.claim.sub','bb22bb22-2222-4222-8222-222222222222',true);
do $b$
begin
  if exists(select 1 from public.v2_coach_threads where
    id='cc33cc33-3333-4333-8333-333333333333') then
    raise exception 'B read A thread';
  end if;
  begin
    perform public.v2_coach_create_thread(
      'bb22bb22-2222-4222-8222-222222222222',
      'cc33cc33-3333-4333-8333-333333333333');
    raise exception 'B claimed A thread';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.v2_coach_create_thread(
      'aa11aa11-1111-4111-8111-111111111111',
      'bb77bb77-7777-4777-8777-777777777777');
    raise exception 'B created thread with A expected identity';
  exception when insufficient_privilege then null;
  end;
end;
$b$;

-- The trusted Edge host only: client never gets the service-role credential.
set local role service_role;
-- Default-OFF production gate must deny pre-provider claims until explicitly
-- enabled on this disposable, transaction-rolled-back test database.
do $policy$
declare v_result jsonb;
begin
 v_result:=public.v2_coach_claim_turn(
  'aa11aa11-1111-4111-8111-111111111111',
  'cc33cc33-3333-4333-8333-333333333333',
  '90909090-9090-4090-8090-909090909090',
  '91919191-9191-4191-8191-919191919191',
  '92929292-9292-4292-8292-929292929292',repeat('e',64));
 if v_result->>'action'<>'rate_unavailable' then
  raise exception 'Coach model spending was enabled by default';
 end if;
end;
$policy$;
-- Only the disposable database administrator can enable the provisional
-- admission policy. Never grant a client or regular service caller UPDATE
-- permission on the policy singleton. Everything rolls back.
reset role;
update allin_private.v2_coach_request_policy set enabled=true
 where singleton=true;
set local role service_role;
-- Trusted host obtains the canonical claim BEFORE invoking any provider.
select public.v2_coach_claim_turn(
 'aa11aa11-1111-4111-8111-111111111111',
 'cc33cc33-3333-4333-8333-333333333333',
 'ee55ee55-5555-4555-8555-555555555555',
 'dd44dd44-4444-4444-8444-444444444444',
 'ff66ff66-6666-4666-8666-666666666666',
 repeat('a',64));

select public.v2_coach_append_exchange(
 'aa11aa11-1111-4111-8111-111111111111',
 'cc33cc33-3333-4333-8333-333333333333',
 'ee55ee55-5555-4555-8555-555555555555',
 'dd44dd44-4444-4444-8444-444444444444',
 'ff66ff66-6666-4666-8666-666666666666',
      1,
 'How should I train?',
 'Please review your accepted plan.'
);
-- The service-only writer has been exercised above. Subsequent direct
-- diagnostic table reads run as disposable test administrator, not as a
-- client/service API role; do not grant direct Coach table reads for tests.
reset role;
-- Exact retry does not add rows OR refresh the thread's "latest activity".
do $retry$
declare before_retry timestamptz; after_retry timestamptz;
begin
  select updated_at into before_retry from public.v2_coach_threads
  where id='cc33cc33-3333-4333-8333-333333333333';
  perform public.v2_coach_append_exchange(
   'aa11aa11-1111-4111-8111-111111111111',
   'cc33cc33-3333-4333-8333-333333333333',
   'ee55ee55-5555-4555-8555-555555555555',
   'dd44dd44-4444-4444-8444-444444444444',
   'ff66ff66-6666-4666-8666-666666666666',
      1,
   'How should I train?',
   'Please review your accepted plan.');
  select updated_at into after_retry from public.v2_coach_threads
  where id='cc33cc33-3333-4333-8333-333333333333';
  if before_retry is distinct from after_retry then
    raise exception 'Exact Coach retry changed thread activity time';
  end if;
end;
$retry$;

do $s$
begin
  if (select count(*) from public.v2_coach_messages
    where client_request_id='ee55ee55-5555-4555-8555-555555555555')<>2 then
    raise exception 'Exact retry wrote duplicate messages';
  end if;
  begin
    perform public.v2_coach_append_exchange(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      'ee55ee55-5555-4555-8555-555555555555',
      'dd44dd44-4444-4444-8444-444444444444',
      'ff66ff66-6666-4666-8666-666666666666',
      1,
      'same request, altered payload',
      'Please review your accepted plan.');
    raise exception 'Changed request reused identity';
  exception when sqlstate '22000' then null;
  end;
  begin
    perform public.v2_coach_append_exchange(
      'bb22bb22-2222-4222-8222-222222222222',
      'cc33cc33-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',1,'bad','bad');
    raise exception 'B server writer targeted A thread';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.v2_coach_append_exchange(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc88cc88-8888-4888-8888-888888888888',
      'ee55ee55-5555-4555-8555-555555555555',
      '10101010-1010-4010-8010-101010101010',
      '20202020-2020-4020-8020-202020202020',
      1,
      'same request moved to a different thread',
      'should not persist');
    raise exception 'A request ID was replayed into a different Coach thread';
  exception when sqlstate '40001' then null;
  end;
  perform public.v2_coach_claim_turn(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      'ff66ff66-6666-4666-8666-666666666666',
      repeat('b',64));
  -- If assistant insertion collides with an existing ID, the newly inserted
  -- user message must roll back with the failing RPC.
  begin
    perform public.v2_coach_append_exchange(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      'ff66ff66-6666-4666-8666-666666666666',
      1,
      'Should not survive',
      'Conflicting existing assistant ID');
    raise exception 'Partial exchange unexpectedly committed';
  exception when sqlstate '22000' then null;
  end;
  if exists(select 1 from public.v2_coach_messages
    where id='55555555-5555-4555-8555-555555555555') then
    raise exception 'Orphan user message persisted after rejected assistant';
  end if;
end;
$s$;

-- Deterministic lease takeover: an expired execution version 1 must not
-- write after version 2 has claimed the same immutable request identity.
reset role;
do $fence$
declare
  v_first jsonb;
  v_reclaimed jsonb;
  v_wait jsonb;
  v_completion jsonb;
begin
  v_first:=public.v2_coach_claim_turn(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    '56565656-5656-4565-8565-565656565656',
    '57575757-5757-4575-8575-575757575757',
    '58585858-5858-4585-8585-585858585858',
    repeat('c',64));
  if v_first->>'action'<>'claimed' or (v_first->>'execution_version')::int<>1 then
    raise exception 'First Coach claim not version 1';
  end if;
  begin
    perform public.v2_coach_claim_turn(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      '56565656-5656-4565-8565-565656565656',
      '57575757-5757-4575-8575-575757575757',
      '58585858-5858-4585-8585-585858585858',
      repeat('d',64));
    raise exception 'Fingerprint change accepted';
  exception when sqlstate '22000' then null;
  end;
  v_wait:=public.v2_coach_claim_turn(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    '56565656-5656-4565-8565-565656565656',
    '57575757-5757-4575-8575-575757575757',
    '58585858-5858-4585-8585-585858585858',
    repeat('c',64));
  if v_wait->>'action'<>'wait' then
    raise exception 'Active Coach lease was stolen';
  end if;
  update allin_private.v2_coach_turn_claims
  set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where user_id='aa11aa11-1111-4111-8111-111111111111'
    and client_request_id='56565656-5656-4565-8565-565656565656';
  v_reclaimed:=public.v2_coach_claim_turn(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    '56565656-5656-4565-8565-565656565656',
    '57575757-5757-4575-8575-575757575757',
    '58585858-5858-4585-8585-585858585858',
    repeat('c',64));
  if v_reclaimed->>'action'<>'claimed' or
    (v_reclaimed->>'execution_version')::int<>2 then
    raise exception 'Expired Coach lease did not advance fence';
  end if;
  begin
    perform public.v2_coach_append_exchange(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      '56565656-5656-4565-8565-565656565656',
      '57575757-5757-4575-8575-575757575757',
      '58585858-5858-4585-8585-585858585858',
      1,'stale provider input','stale assistant output');
    raise exception 'Stale provider appended after lease takeover';
  exception when sqlstate '40001' then null;
  end;
  if exists(select 1 from public.v2_coach_messages
     where client_request_id='56565656-5656-4565-8565-565656565656') then
    raise exception 'Stale provider created canonical message rows';
  end if;
  perform public.v2_coach_append_exchange(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    '56565656-5656-4565-8565-565656565656',
    '57575757-5757-4575-8575-575757575757',
    '58585858-5858-4585-8585-585858585858',
    2,'current provider input','current assistant output');
  begin
    perform public.v2_coach_finish_turn(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',
      '56565656-5656-4565-8565-565656565656',
      '58585858-5858-4585-8585-585858585858',1);
    raise exception 'Stale execution finalized newer Coach reply';
  exception when sqlstate '40001' then null;
  end;
  v_completion:=public.v2_coach_finish_turn(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    '56565656-5656-4565-8565-565656565656',
    '58585858-5858-4585-8585-585858585858',2);
  if (v_completion->>'completed')::boolean is distinct from true then
    raise exception 'Fenced Coach completion not confirmed';
  end if;
  v_completion:=public.v2_coach_claim_turn(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    '56565656-5656-4565-8565-565656565656',
    '57575757-5757-4575-8575-575757575757',
    '58585858-5858-4585-8585-585858585858',
    repeat('c',64));
  if v_completion->>'action'<>'completed' then
    raise exception 'Completed request triggered new provider claim';
  end if;
end;
$fence$;

-- Return to A and verify the bounded owner-only transcript reader.
set local role authenticated;
select set_config('request.jwt.claim.sub','aa11aa11-1111-4111-8111-111111111111',true);
do $r$
declare v_count integer;
begin
  select count(*) into v_count from public.v2_coach_read_messages(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',null,null,40);
  if v_count<>2 then raise exception 'A did not read both canonical messages'; end if;
  -- Exact RPC readback must require both message IDs + owner + request.
  select count(*) into v_count from public.v2_coach_read_exchange(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    'ee55ee55-5555-4555-8555-555555555555',
    'dd44dd44-4444-4444-8444-444444444444',
    'ff66ff66-6666-4666-8666-666666666666');
  if v_count<>2 then
    raise exception 'Exact owner readback did not return the message pair';
  end if;
  select count(*) into v_count from public.v2_coach_read_exchange(
    'aa11aa11-1111-4111-8111-111111111111',
    'cc33cc33-3333-4333-8333-333333333333',
    'ee55ee55-5555-4555-8555-555555555555',
    'dd44dd44-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333');
  if v_count<>0 then
    raise exception 'Wrong assistant message ID returned a partial exchange';
  end if;
  begin
    perform * from public.v2_coach_read_messages(
      'aa11aa11-1111-4111-8111-111111111111',
      'cc33cc33-3333-4333-8333-333333333333',null,null,51);
    raise exception 'Unbounded transcript read unexpectedly allowed';
  exception when sqlstate '22023' then null;
  end;
end;
$r$;
select set_config('request.jwt.claim.sub','bb22bb22-2222-4222-8222-222222222222',true);
do $r$
begin
  begin
    perform * from public.v2_coach_read_exchange(
      'bb22bb22-2222-4222-8222-222222222222',
      'cc33cc33-3333-4333-8333-333333333333',
      'ee55ee55-5555-4555-8555-555555555555',
      'dd44dd44-4444-4444-8444-444444444444',
      'ff66ff66-6666-4666-8666-666666666666');
    raise exception 'B read A exact Coach exchange';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.v2_coach_read_messages(
      'bb22bb22-2222-4222-8222-222222222222',
      'cc33cc33-3333-4333-8333-333333333333',null,null,40);
    raise exception 'B read A transcript';
  exception when insufficient_privilege then null;
  end;
end;
$r$;

reset role;
rollback;
