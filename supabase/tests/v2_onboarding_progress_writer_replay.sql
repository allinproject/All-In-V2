-- V2 onboarding progress writer authenticated replay.
-- Safe to run against the isolated V2 project: all synthetic data is rolled back.

begin;

insert into auth.users (
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous
) values
  ('5f256254-0a6c-47e8-8da9-7aefc15c44c1','authenticated','authenticated','v2-onboarding-a@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now(),false),
  ('6f256254-0a6c-47e8-8da9-7aefc15c44c1','authenticated','authenticated','v2-onboarding-b@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now(),false);

set local role authenticated;
select set_config('request.jwt.claim.sub','5f256254-0a6c-47e8-8da9-7aefc15c44c1',true);

do $$
declare
  v_first bigint;
  v_retry bigint;
  v_noop bigint;
  v_next bigint;
  v_version bigint;
  v_completed text[];
  v_skipped text[];
  v_completed_at timestamptz;
begin
  v_first := public.v2_set_onboarding_step('focus','complete',1,'onboarding-action-1');
  if v_first <> 2 then raise exception 'first update should return version 2, got %',v_first; end if;

  v_retry := public.v2_set_onboarding_step('focus','complete',1,'onboarding-action-1');
  if v_retry <> 2 then raise exception 'exact retry should return original version 2, got %',v_retry; end if;

  v_noop := public.v2_set_onboarding_step('focus','complete',2,'onboarding-action-noop');
  if v_noop <> 2 then raise exception 'same-state action should remain version 2, got %',v_noop; end if;

  begin
    perform public.v2_set_onboarding_step('training_pattern','skip',2,'onboarding-action-1');
    raise exception 'changed-payload action-ID reuse unexpectedly succeeded';
  exception when sqlstate '22000' then
    null;
  end;

  begin
    perform public.v2_set_onboarding_step('availability','complete',1,'onboarding-stale-action');
    raise exception 'stale expected version unexpectedly succeeded';
  exception when sqlstate '40001' then
    null;
  end;

  v_next := public.v2_set_onboarding_step('training_pattern','skip',2,'onboarding-action-2');
  if v_next <> 3 then raise exception 'skip should advance version to 3, got %',v_next; end if;

  v_next := public.v2_set_onboarding_step('focus','reset',3,'onboarding-action-3');
  if v_next <> 4 then raise exception 'reset should advance version to 4, got %',v_next; end if;

  -- A retry from version 2 must still return its original result after version 4 exists.
  v_retry := public.v2_set_onboarding_step('focus','complete',1,'onboarding-action-1');
  if v_retry <> 2 then raise exception 'late exact retry did not return original version 2, got %',v_retry; end if;

  select version,completed_steps,skipped_steps,completed_at
    into v_version,v_completed,v_skipped,v_completed_at
  from public.v2_onboarding_progress
  where user_id = auth.uid();

  if v_version <> 4 then raise exception 'expected final version 4, got %',v_version; end if;
  if 'focus'=any(v_completed) or 'focus'=any(v_skipped) then raise exception 'reset did not remove focus'; end if;
  if not ('training_pattern'=any(v_skipped)) then raise exception 'skip was not preserved'; end if;
  if v_completed_at is not null then raise exception 'onboarding must not be complete while steps remain'; end if;

  begin
    update public.v2_onboarding_progress
      set completed_steps=array['focus']::text[]
      where user_id=auth.uid();
    raise exception 'direct authenticated onboarding UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.v2_onboarding_progress(user_id)
      values (auth.uid());
    raise exception 'direct authenticated onboarding INSERT unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub','6f256254-0a6c-47e8-8da9-7aefc15c44c1',true);
do $$
begin
  if exists (
    select 1 from public.v2_onboarding_progress
    where user_id='5f256254-0a6c-47e8-8da9-7aefc15c44c1'
  ) then
    raise exception 'second authenticated user can read first user onboarding row';
  end if;
  if public.v2_set_onboarding_step('focus','skip',1,'user-b-onboarding-action') <> 2 then
    raise exception 'second user onboarding writer failed';
  end if;
end;
$$;

reset role;
rollback;
