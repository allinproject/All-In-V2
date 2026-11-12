-- ALL-247: REVIEW CANDIDATE ONLY. Never apply to production without ALL-222/ALL-251 gates.
-- First bounded slice: owner-bound manual consumed food creation with idempotent replay.
create table public.v2_food_log_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consumed_at timestamptz not null,
  local_date date not null,
  timezone_name text not null check (length(timezone_name) between 1 and 80),
  meal_slot text not null check (meal_slot in ('breakfast','lunch','dinner','snack','other')),
  label text not null check (length(btrim(label)) between 1 and 200),
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null check (unit in ('g','ml','oz','fl_oz','serving','each')),
  kcal numeric(12,4) check (kcal >= 0),
  nutrition_source text not null check (nutrition_source in ('user_entered','unknown')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  constraint v2_food_manual_source_consistent check (
    (nutrition_source = 'unknown' and kcal is null) or
    (nutrition_source = 'user_entered')
  )
);
create index v2_food_log_entries_owner_day_idx on public.v2_food_log_entries(user_id,local_date,consumed_at,id);
alter table public.v2_food_log_entries enable row level security;
revoke all on public.v2_food_log_entries from public,anon,authenticated,service_role;
grant select on public.v2_food_log_entries to authenticated;
create policy v2_food_log_entries_select_own on public.v2_food_log_entries
 for select to authenticated using ((select auth.uid())=user_id);
create table allin_private.v2_food_log_write_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null,
  request_fingerprint text not null,
  result_id uuid not null,
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id,action_id)
);
alter table allin_private.v2_food_log_write_actions enable row level security;
revoke all on allin_private.v2_food_log_write_actions from public,anon,authenticated,service_role;

create function public.v2_food_log_add_manual(
 p_expected_user_id uuid,
 p_action_id uuid,
 p_entry_id uuid,
 p_consumed_at timestamptz,
 p_local_date date,
 p_timezone_name text,
 p_meal_slot text,
 p_label text,
 p_quantity numeric,
 p_unit text,
 p_kcal numeric,
 p_nutrition_source text
) returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
 v_actor uuid := auth.uid();
 v_hash text;
 v_old allin_private.v2_food_log_write_actions%rowtype;
begin
 if v_actor is null or p_expected_user_id is null or v_actor <> p_expected_user_id then
   raise exception 'Not authorized for expected account' using errcode='42501';
 end if;
 if p_action_id is null or p_entry_id is null then
   raise exception 'Action and entry IDs required' using errcode='22023';
 end if;
 if p_consumed_at is null or p_local_date is null or
    p_timezone_name is null or length(p_timezone_name) not between 1 and 80 or
    p_meal_slot is null or p_meal_slot not in ('breakfast','lunch','dinner','snack','other') or
    p_label is null or length(btrim(p_label)) not between 1 and 200 or
    p_quantity is null or p_quantity <= 0 or p_quantity > 9999999999 or
    p_unit is null or p_unit not in ('g','ml','oz','fl_oz','serving','each') or
    p_nutrition_source is null or p_nutrition_source not in ('user_entered','unknown') or
    (p_nutrition_source = 'unknown' and p_kcal is not null) or
    p_kcal < 0 then
   raise exception 'Invalid food log entry' using errcode='22023';
 end if;
 -- Capture complete semantically relevant inputs; replay never recalculates nutrition.
 v_hash := md5(jsonb_build_array(p_entry_id,p_consumed_at,p_local_date,p_timezone_name,
           p_meal_slot,p_label,p_quantity,p_unit,p_kcal,p_nutrition_source)::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,247));
 select * into v_old from allin_private.v2_food_log_write_actions
 where user_id=v_actor and action_id=p_action_id;
 if found then
   if v_old.request_fingerprint <> v_hash then
     raise exception 'Action reused with different content' using errcode='22000';
   end if;
   return jsonb_build_object('id',v_old.result_id,'revision',v_old.result_revision,'replayed',true);
 end if;
 insert into public.v2_food_log_entries
 (id,user_id,consumed_at,local_date,timezone_name,meal_slot,label,quantity,unit,kcal,nutrition_source)
 values (p_entry_id,v_actor,p_consumed_at,p_local_date,p_timezone_name,p_meal_slot,p_label,p_quantity,p_unit,p_kcal,p_nutrition_source);
 insert into allin_private.v2_food_log_write_actions
 (user_id,action_id,request_fingerprint,result_id,result_revision)
 values (v_actor,p_action_id,v_hash,p_entry_id,1);
 return jsonb_build_object('id',p_entry_id,'revision',1,'replayed',false);
end
$fn$;
revoke all on function public.v2_food_log_add_manual(uuid,uuid,uuid,timestamptz,date,text,text,text,numeric,text,numeric,text)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_food_log_add_manual(uuid,uuid,uuid,timestamptz,date,text,text,text,numeric,text,numeric,text)
 to authenticated;
