create table allin_private.v2_stripe_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id text not null unique,
  checkout_id uuid,
  checkout_expires bigint,
  revision integer not null default 0,
  subscription_id text,
  subscription_status text,
  access_until timestamptz,
  cancel_at_period_end boolean not null default false
);

create table allin_private.v2_stripe_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

alter table allin_private.v2_stripe_accounts enable row level security;
alter table allin_private.v2_stripe_events enable row level security;
revoke all on allin_private.v2_stripe_accounts, allin_private.v2_stripe_events
  from public, anon, authenticated, service_role;

create function public.v2_stripe_account(p_user uuid, p_customer text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(a) from allin_private.v2_stripe_accounts a
  where (p_user is not null and a.user_id = p_user)
     or (p_user is null and a.customer_id = p_customer);
$$;

create function public.v2_stripe_bind(p_user uuid, p_customer text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  insert into allin_private.v2_stripe_accounts (user_id, customer_id)
  values (p_user, p_customer) on conflict (user_id) do nothing;
  return (select customer_id from allin_private.v2_stripe_accounts where user_id = p_user);
end;
$$;

create function public.v2_stripe_reserve_checkout(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()));
  v_account allin_private.v2_stripe_accounts;
begin
  select * into strict v_account from allin_private.v2_stripe_accounts
  where user_id = p_user for update;
  if v_account.checkout_expires is null or v_account.checkout_expires <= v_now then
    update allin_private.v2_stripe_accounts
    set checkout_id = gen_random_uuid(), checkout_expires = v_now + 3600
    where user_id = p_user returning * into v_account;
  end if;
  return jsonb_build_object('id', v_account.checkout_id, 'expires', v_account.checkout_expires);
end;
$$;

create function public.v2_stripe_apply_event(
  p_event text, p_customer text, p_revision integer,
  p_subscription text, p_status text, p_until timestamptz, p_cancel boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_revision integer;
begin
  select revision into v_revision from allin_private.v2_stripe_accounts
  where customer_id = p_customer for update;
  if not found then return 'unknown'; end if;
  if exists (select 1 from allin_private.v2_stripe_events where event_id = p_event) then
    return 'duplicate';
  end if;
  if v_revision is distinct from p_revision then return 'retry'; end if;

  insert into allin_private.v2_stripe_events (event_id) values (p_event)
  on conflict do nothing;
  if not found then return 'duplicate'; end if;

  update allin_private.v2_stripe_accounts
  set revision = revision + 1, subscription_id = p_subscription,
      subscription_status = p_status, access_until = p_until, cancel_at_period_end = p_cancel
  where customer_id = p_customer;
  return 'applied';
end;
$$;

revoke execute on function public.v2_stripe_account(uuid, text),
  public.v2_stripe_bind(uuid, text), public.v2_stripe_reserve_checkout(uuid),
  public.v2_stripe_apply_event(text, text, integer, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.v2_stripe_account(uuid, text),
  public.v2_stripe_bind(uuid, text), public.v2_stripe_reserve_checkout(uuid),
  public.v2_stripe_apply_event(text, text, integer, text, text, timestamptz, boolean)
  to service_role;
