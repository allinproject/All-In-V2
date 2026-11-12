-- ALL-248 / ALL-222 REVIEW ONLY — NOT A MIGRATION OR DEPLOYMENT.
-- Canonical Kitchen owns physical stock and user-added shopping extras.
-- Planned Shopping shortages are a DERIVED view over verified Plan+Pantry,
-- never a second mutable set of rows. Cookbook food identity FKs must be
-- replaced with reviewed canonical source references before deployment.
-- ALL-251 export/deletion, ingredient identity, location & receipt admission pending.

create table public.v2_kitchen_pantry_lots (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 food_source_id text not null check(length(btrim(food_source_id)) between 1 and 160),
 preparation_state text not null check(length(btrim(preparation_state)) between 1 and 80),
 unit text not null check(length(btrim(unit)) between 1 and 40),
 stock_location text not null check(stock_location in ('pantry','fridge','freezer','spices')),
 on_hand numeric(15,3) not null check(on_hand>=0),
 reserved numeric(15,3) not null default 0 check(reserved>=0 and reserved<=on_hand),
 expiry_date date,
 usable boolean not null default true,
 version bigint not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 primary key(user_id,id)
);
create index v2_kitchen_pantry_identity_lookup on public.v2_kitchen_pantry_lots
 (user_id,food_source_id,preparation_state,unit);

-- User-added extras are not regenerated from Meal Plan and must survive
-- recalculation. An in-cart checkbox is NOT a confirmed purchase.
create table public.v2_kitchen_shopping_manual_lines (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 food_source_id text,
 description text not null check(length(btrim(description)) between 1 and 200),
 preparation_state text,
 unit text,
 requested_quantity numeric(15,3) check(requested_quantity>0),
 state text not null default 'needed' check(state in ('needed','in_cart','archived')),
 version bigint not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 primary key(user_id,id),
 constraint kitchen_shopping_manual_identity_state check (
  (food_source_id is null and preparation_state is null and unit is null)
  or (food_source_id is not null and preparation_state is not null and unit is not null))
);
-- Exact confirmed purchase records are separate historical receipts, not
-- shopping-list completion inferred from an in-cart checkbox.
create table public.v2_kitchen_purchase_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 client_action_id uuid not null,
 confirmed_at timestamptz not null default now(),
 primary key(user_id,id),
 unique(user_id,client_action_id)
);
create table public.v2_kitchen_purchase_receipt_lines (
 user_id uuid not null,
 receipt_id uuid not null,
 line_id uuid not null,
 food_source_id text not null check(length(btrim(food_source_id)) between 1 and 160),
 preparation_state text not null check(length(btrim(preparation_state)) between 1 and 80),
 unit text not null check(length(btrim(unit)) between 1 and 40),
 purchased_quantity numeric(15,3) not null check(purchased_quantity>0),
 pantry_lot_id uuid,
 primary key(user_id,receipt_id,line_id),
 foreign key(user_id,receipt_id) references public.v2_kitchen_purchase_receipts(user_id,id)
   on delete cascade,
 foreign key(user_id,pantry_lot_id) references public.v2_kitchen_pantry_lots(user_id,id)
   on delete set null (pantry_lot_id)
);

alter table public.v2_kitchen_pantry_lots enable row level security;
alter table public.v2_kitchen_shopping_manual_lines enable row level security;
alter table public.v2_kitchen_purchase_receipts enable row level security;
alter table public.v2_kitchen_purchase_receipt_lines enable row level security;

-- No client direct mutation of stock, shopping items or receipts.
revoke all on public.v2_kitchen_pantry_lots from public,anon,authenticated,service_role;
revoke all on public.v2_kitchen_shopping_manual_lines from public,anon,authenticated,service_role;
revoke all on public.v2_kitchen_purchase_receipts from public,anon,authenticated,service_role;
revoke all on public.v2_kitchen_purchase_receipt_lines from public,anon,authenticated,service_role;

-- Reuse one canonical owner read API; no new mutable shopping projection.
-- A missing row is not evidence that other owner-scope responses are complete.
create function public.v2_kitchen_read_stock_and_manual_shopping(
 p_expected_user_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Kitchen ownership mismatch' using errcode='42501';
 end if;
 return jsonb_build_object(
  'ownerId',v_user,'complete',true,
  'pantryLots',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'foodId',p.food_source_id,'preparationState',p.preparation_state,
   'unit',p.unit,'onHand',p.on_hand,'reserved',p.reserved,
   'location',p.stock_location,'usable',p.usable,'expiryDate',p.expiry_date,
   'version',p.version) order by p.id)
   from public.v2_kitchen_pantry_lots p where p.user_id=v_user),'[]'::jsonb),
  'manualShopping',coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'foodId',s.food_source_id,'description',s.description,
   'preparationState',s.preparation_state,'unit',s.unit,
   'requestedQuantity',s.requested_quantity,'state',s.state,'version',s.version)
   order by s.id) from public.v2_kitchen_shopping_manual_lines s
   where s.user_id=v_user and s.state<>'archived'),'[]'::jsonb));
end;
$$;
revoke all on function public.v2_kitchen_read_stock_and_manual_shopping(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_kitchen_read_stock_and_manual_shopping(uuid)
 to authenticated;

-- Owner-scoped idempotency ledger for manual Shopping state only.
-- Auto-generated Shopping needs have NO persistent shadow rows here.
create table allin_private.v2_kitchen_manual_shopping_actions (
 user_id uuid not null references auth.users(id) on delete cascade,
 action_id uuid not null,
 line_id uuid not null,
 payload jsonb not null,
 result_version bigint not null,
 created_at timestamptz not null default now(),
 primary key(user_id,action_id)
);
alter table allin_private.v2_kitchen_manual_shopping_actions enable row level security;
revoke all on allin_private.v2_kitchen_manual_shopping_actions
 from public,anon,authenticated,service_role;

create function public.v2_kitchen_write_manual_shopping(
 p_expected_user_id uuid,
 p_line_id uuid,
 p_expected_version bigint,
 p_action_id uuid,
 p_description text,
 p_food_source_id text,
 p_preparation_state text,
 p_unit text,
 p_quantity numeric,
 p_state text
) returns bigint
language plpgsql security definer set search_path=''
as $kitchen_write$
declare
 v_user uuid:=auth.uid();
 v_payload jsonb;
 v_prior allin_private.v2_kitchen_manual_shopping_actions%rowtype;
 v_previous public.v2_kitchen_shopping_manual_lines%rowtype;
 v_version bigint;
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Kitchen manual Shopping ownership mismatch' using errcode='42501';
 end if;
 if p_line_id is null or p_action_id is null or p_expected_version is null
    or p_expected_version<0 or p_description is null
    or length(btrim(p_description)) not between 1 and 200
    or p_description<>btrim(p_description)
    or p_state is null or p_state not in ('needed','in_cart','archived')
    or (p_food_source_id is null and
         (p_preparation_state is not null or p_unit is not null))
    or (p_food_source_id is not null and
         (p_preparation_state is null or p_unit is null))
    or (p_food_source_id is not null and (
          length(btrim(p_food_source_id)) not between 1 and 160
          or p_food_source_id<>btrim(p_food_source_id)
          or length(btrim(p_preparation_state)) not between 1 and 80
          or length(btrim(p_unit)) not between 1 and 40))
    or (p_quantity is not null and (p_quantity<=0 or p_quantity>1000000000))
 then raise exception 'Invalid manual Shopping line' using errcode='22023';
 end if;
 v_payload:=jsonb_build_object('id',p_line_id,'description',p_description,
  'sourceId',p_food_source_id,'state',p_state,'preparation',p_preparation_state,
  'unit',p_unit,'quantity',p_quantity);
 perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_line_id::text,248));
 select * into v_prior from allin_private.v2_kitchen_manual_shopping_actions
  where user_id=v_user and action_id=p_action_id;
 if found then
  if v_prior.line_id is distinct from p_line_id
     or v_prior.payload is distinct from v_payload then
   raise exception 'Kitchen manual Shopping action reused with different contents'
    using errcode='22000';
  end if;
  return v_prior.result_version;
 end if;
 select * into v_previous from public.v2_kitchen_shopping_manual_lines
  where user_id=v_user and id=p_line_id for update;
 if found then
  if p_expected_version<>v_previous.version then
   raise exception 'Manual Shopping changed; reload before saving'
    using errcode='40001';
  end if;
  if v_previous.state='archived' then
   raise exception 'Archived Shopping line cannot be reopened by stale request'
    using errcode='22023';
  end if;
  update public.v2_kitchen_shopping_manual_lines
   set description=p_description,food_source_id=p_food_source_id,
       preparation_state=p_preparation_state,unit=p_unit,
       requested_quantity=p_quantity,state=p_state,
       version=version+1,updated_at=now()
   where user_id=v_user and id=p_line_id
   returning version into v_version;
 else
  if p_expected_version<>0 or p_state='archived' then
   raise exception 'Manual Shopping line missing or revision mismatch'
    using errcode='40001';
  end if;
  insert into public.v2_kitchen_shopping_manual_lines
    (user_id,id,description,food_source_id,preparation_state,unit,
     requested_quantity,state)
  values(v_user,p_line_id,p_description,p_food_source_id,p_preparation_state,
    p_unit,p_quantity,p_state)
  returning version into v_version;
 end if;
 insert into allin_private.v2_kitchen_manual_shopping_actions
  (user_id,action_id,line_id,payload,result_version)
 values (v_user,p_action_id,p_line_id,v_payload,v_version);
 return v_version;
end;
$kitchen_write$;
revoke all on function public.v2_kitchen_write_manual_shopping(
 uuid,uuid,bigint,uuid,text,text,text,text,numeric,text)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_kitchen_write_manual_shopping(
 uuid,uuid,bigint,uuid,text,text,text,text,numeric,text) to authenticated;

-- RELEASE-BLOCKING TODO: a single transactional, idempotent, version/CAS
-- shopping/receipt writer must validate actual reviewed purchased quantity,
-- stock identity+state+unit, owner, active session, duplicate actions and
-- Pantry updates, with rollback. An in-cart toggle alone can NEVER add stock.
-- Separate historical receipts from manual shopping lines (which remain
-- user-maintained), and derive automatic shortages from current Plan+Pantry.
-- Review per-lot expiry/time allocations, preparation conversions, aliases,
-- storage capacities, receipt retention, export and account deletion first.
