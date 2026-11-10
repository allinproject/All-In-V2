-- V2 expected-owner mutation guard replay.
-- Verifies that settings, legal acceptance and onboarding writers compare the
-- screen's expected identity to auth.uid() inside PostgreSQL, not only in UI.
-- All synthetic Auth users and mutations are rolled back.

begin;

insert into auth.users (
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous
) values
  ('5f256254-0a6c-47e8-8da9-7aefc15c44c1','authenticated','authenticated','v2-owner-guard-a@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now(),false),
  ('6f256254-0a6c-47e8-8da9-7aefc15c44c1','authenticated','authenticated','v2-owner-guard-b@example.invalid','{}'::jsonb,'{}'::jsonb,now(),now(),false);

set local role authenticated;
select set_config('request.jwt.claim.sub','5f256254-0a6c-47e8-8da9-7aefc15c44c1',true);

do $$
begin
  begin
    perform public.v2_patch_profile_settings_section(
      '6f256254-0a6c-47e8-8da9-7aefc15c44c1',
      'training_preferences',
      '{"focus":"run"}'::jsonb,
      1,
      'wrong-owner-settings'
    );
    raise exception 'profile settings writer accepted a different expected owner';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    perform public.v2_accept_legal_documents(
      '6f256254-0a6c-47e8-8da9-7aefc15c44c1',
      'terms-v2',
      'privacy-v2',
      'founder-v2',
      true,
      'wrong-owner-legal'
    );
    raise exception 'legal writer accepted a different expected owner';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    perform public.v2_set_onboarding_step(
      '6f256254-0a6c-47e8-8da9-7aefc15c44c1',
      'focus',
      'complete',
      1,
      'wrong-owner-onboarding'
    );
    raise exception 'onboarding writer accepted a different expected owner';
  exception when sqlstate '42501' then
    null;
  end;

  -- Correct owner still passes the identity guard and reaches its domain rule.
  begin
    perform public.v2_patch_profile_settings_section(
      '5f256254-0a6c-47e8-8da9-7aefc15c44c1',
      'training_preferences',
      '{"focus":"run"}'::jsonb,
      1,
      'correct-owner-settings-stale'
    );
  exception when sqlstate '40001' then
    raise exception 'settings writer unexpectedly had a stale initial version';
  end;
end;
$$;

-- Switch JWT identity to account B; account A's expected identity must fail.
select set_config('request.jwt.claim.sub','6f256254-0a6c-47e8-8da9-7aefc15c44c1',true);

do $$
begin
  begin
    perform public.v2_set_onboarding_step(
      '5f256254-0a6c-47e8-8da9-7aefc15c44c1',
      'focus',
      'skip',
      1,
      'user-b-wrong-owner-onboarding'
    );
    raise exception 'account B writer accepted account A expected owner';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;
rollback;
