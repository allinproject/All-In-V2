-- Run against an isolated database after applying the source migrations.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_customer text := 'cus_' || replace(v_user::text, '-', '');
  v_event text := 'evt_' || replace(v_user::text, '-', '');
  v_attempt jsonb;
  v_result text;
begin
  if has_function_privilege('authenticated', 'public.v2_stripe_account(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.v2_stripe_account(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.v2_stripe_apply_event(text,text,integer,text,text,timestamptz,boolean)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.v2_stripe_apply_event(text,text,integer,text,text,timestamptz,boolean)', 'EXECUTE')
  then
    raise exception 'Client roles can read or write Stripe billing state';
  end if;

  insert into auth.users (id) values (v_user);
  if public.v2_stripe_bind(v_user, v_customer) is distinct from v_customer then
    raise exception 'Customer binding failed';
  end if;
  if public.v2_stripe_bind(v_user, 'cus_other') is distinct from v_customer then
    raise exception 'Customer binding changed on retry';
  end if;

  v_attempt := public.v2_stripe_reserve_checkout(v_user);
  if v_attempt->>'id' is null
     or public.v2_stripe_reserve_checkout(v_user) is distinct from v_attempt
  then
    raise exception 'Checkout reservation changed on retry';
  end if;

  v_result := public.v2_stripe_apply_event(
    v_event, v_customer, 0, 'sub_test', 'active', now() + interval '1 month', false
  );
  if v_result is distinct from 'applied' then
    raise exception 'Initial webhook was not applied: %', v_result;
  end if;
  v_result := public.v2_stripe_apply_event(
    v_event, v_customer, 0, 'sub_test', 'canceled', null, false
  );
  if v_result is distinct from 'duplicate' then
    raise exception 'Duplicate event was not ignored: %', v_result;
  end if;
  v_result := public.v2_stripe_apply_event(
    v_event || '_new', v_customer, 0, 'sub_test', 'canceled', null, false
  );
  if v_result is distinct from 'retry'
     or public.v2_stripe_account(null, v_customer)->>'subscription_status' is distinct from 'active'
  then
    raise exception 'Stale snapshot changed the entitlement';
  end if;
  v_result := public.v2_stripe_apply_event(
    v_event || '_new', v_customer, 1, 'sub_test', 'canceled', null, false
  );
  if v_result is distinct from 'applied'
     or public.v2_stripe_account(null, v_customer)->>'access_until' is not null
  then
    raise exception 'Retried cancellation did not clear access';
  end if;
end;
$$;

rollback;
