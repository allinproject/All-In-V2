-- ALL-248 / ALL-222 REVIEW-ONLY CANDIDATE; NOT AN APPLIED MIGRATION.
-- Requires approved Cookbook/Ingredient canonical IDs and ALL-251 export/deletion graph
-- before release; source_id is a bounded temporary reference awaiting typed FKs.
-- One canonical owner; no Food Log writes, Pantry mutation, Shopping-list clone.
create table public.v2_kitchen_plan_weeks (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start),
  constraint v2_kitchen_week_is_monday check (extract(isodow from week_start)=1)
);

create table public.v2_kitchen_plan_entries (
  id uuid not null,
  user_id uuid not null,
  week_start date not null,
  eat_date date not null,
  meal_slot text not null check (meal_slot in ('breakfast','lunch','dinner','snack')),
  source_kind text not null check (source_kind in ('recipe','food','prepared_meal')),
  source_id text not null check (length(btrim(source_id)) between 1 and 160 and source_id=btrim(source_id)),
  portions numeric(10,3) not null check (portions > 0 and portions <= 100),
  execution_mode text not null check (execution_mode in
    ('cook_that_day','prep_ahead','already_prepared','planned_food')),
  created_at timestamptz not null default now(),
  primary key (user_id,id),
  foreign key (user_id,week_start) references public.v2_kitchen_plan_weeks(user_id,week_start)
    on delete cascade,
  constraint v2_kitchen_recipe_one_serving_per_date check
    (source_kind <> 'recipe' or portions = 1),
  constraint v2_kitchen_food_mode check
    (source_kind <> 'food' or execution_mode='planned_food'),
  constraint v2_kitchen_prepared_mode check
    (source_kind <> 'prepared_meal' or execution_mode='already_prepared'),
  constraint v2_kitchen_date_in_week check
    (eat_date >= week_start and eat_date < week_start + 7)
);
create index v2_kitchen_entries_by_day
 on public.v2_kitchen_plan_entries(user_id,eat_date,meal_slot);

create table allin_private.v2_kitchen_plan_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null,
  week_start date not null,
  payload jsonb not null,
  result_version bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id,action_id)
);

alter table public.v2_kitchen_plan_weeks enable row level security;
alter table public.v2_kitchen_plan_entries enable row level security;
alter table allin_private.v2_kitchen_plan_actions enable row level security;
-- Defense-in-depth RLS for owner read; direct client grants remain revoked.
create policy v2_kitchen_week_owner_read on public.v2_kitchen_plan_weeks
 for select to authenticated using ((select auth.uid())=user_id);
create policy v2_kitchen_entry_owner_read on public.v2_kitchen_plan_entries
 for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.v2_kitchen_plan_weeks from public, anon, authenticated, service_role;
revoke all on public.v2_kitchen_plan_entries from public, anon, authenticated, service_role;
revoke all on allin_private.v2_kitchen_plan_actions from public, anon, authenticated, service_role;

-- Complete owner-scoped week; zero entries is a confirmed empty plan, not missing data.
create function public.v2_kitchen_read_plan_week(
 p_expected_user_id uuid,p_week_start date
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid := auth.uid(); v_week public.v2_kitchen_plan_weeks%rowtype;
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
   raise exception 'Kitchen plan owner mismatch' using errcode='42501';
 end if;
 if p_week_start is null or extract(isodow from p_week_start)<>1 then
   raise exception 'Week must begin on Monday' using errcode='22023';
 end if;
 select * into v_week from public.v2_kitchen_plan_weeks
 where user_id=v_user and week_start=p_week_start;
 return jsonb_build_object(
  'ownerId',v_user,'weekStart',p_week_start,'version',coalesce(v_week.version,0),
  'complete',true,'entries',
  coalesce((select jsonb_agg(jsonb_build_object(
   'id',e.id,'eatDate',e.eat_date,'mealSlot',e.meal_slot,
   'sourceKind',e.source_kind,'sourceId',e.source_id,
   'portions',e.portions,'executionMode',e.execution_mode)
   order by e.eat_date,e.meal_slot,e.id)
   from public.v2_kitchen_plan_entries e
   where e.user_id=v_user and e.week_start=p_week_start),'[]'::jsonb));
end;
$$;

-- One authorized transactional replacement per complete week.
-- Exact action retries replay previous result; revisions reject stale concurrent edits.
create function public.v2_kitchen_replace_plan_week(
 p_expected_user_id uuid,p_week_start date,p_expected_version bigint,
 p_action_id uuid,p_entries jsonb
) returns bigint language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid := auth.uid();
 v_version bigint;
 v_prior allin_private.v2_kitchen_plan_actions%rowtype;
 v_row jsonb;
 v_id uuid;
 v_date date;
 v_slot text;
 v_kind text;
 v_source text;
 v_portions numeric;
 v_mode text;
 v_ids uuid[] := '{}'::uuid[];
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
   raise exception 'Kitchen plan owner mismatch' using errcode='42501';
 end if;
 if p_week_start is null or extract(isodow from p_week_start)<>1
   or p_expected_version is null or p_expected_version < 0
   or p_action_id is null or p_entries is null
   or jsonb_typeof(p_entries)<>'array'
   or jsonb_array_length(p_entries)>150 then
   raise exception 'Invalid complete-week plan input' using errcode='22023';
 end if;
 -- Reject invalid rows BEFORE touching canonical owner state.
 for v_row in select value from jsonb_array_elements(p_entries) loop
   if jsonb_typeof(v_row)<>'object'
     or (select count(*) from jsonb_object_keys(v_row) as k)
       <> (select count(*) from jsonb_object_keys(v_row) as k
         where k in ('id','eatDate','mealSlot','sourceKind','sourceId','portions','executionMode'))
     or (select count(*) from jsonb_object_keys(v_row) as k)<>7 then
     raise exception 'Unsupported plan entry shape' using errcode='22023';
   end if;
   begin
    v_id := (v_row->>'id')::uuid;
    v_date := (v_row->>'eatDate')::date;
    v_portions := (v_row->>'portions')::numeric;
   exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'Invalid plan entry identity, date or portion' using errcode='22023';
   end;
   v_slot := v_row->>'mealSlot';
   v_kind := v_row->>'sourceKind';
   v_source := v_row->>'sourceId';
   v_mode := v_row->>'executionMode';
   if v_id is null or v_id=any(v_ids)
     or v_date is null or v_date<p_week_start or v_date>=p_week_start+7
     or v_slot is null or v_slot not in ('breakfast','lunch','dinner','snack')
     or v_kind is null or v_kind not in ('recipe','food','prepared_meal')
     or v_source is null or length(btrim(v_source)) not between 1 and 160
     or v_source<>btrim(v_source)
     or v_portions is null or v_portions<=0 or v_portions>100
     or (v_kind='recipe' and v_portions<>1)
     or v_mode is null or v_mode not in ('cook_that_day','prep_ahead','already_prepared','planned_food')
     or (v_kind='food' and v_mode<>'planned_food')
     or (v_kind='prepared_meal' and v_mode<>'already_prepared')
   then raise exception 'Invalid planned food or recipe entry' using errcode='22023';
   end if;
   v_ids := array_append(v_ids,v_id);
 end loop;
 -- Serialize all changes to this exact user/week, including same-week retries.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_week_start::text,248));
 select * into v_prior from allin_private.v2_kitchen_plan_actions
 where user_id=v_user and action_id=p_action_id;
 if found then
   if v_prior.week_start is distinct from p_week_start
      or v_prior.payload is distinct from p_entries then
      raise exception 'Kitchen action ID reused with different content' using errcode='22000';
   end if;
   return v_prior.result_version;
 end if;
 insert into public.v2_kitchen_plan_weeks(user_id,week_start)
 values(v_user,p_week_start) on conflict do nothing;
 select version into v_version from public.v2_kitchen_plan_weeks
 where user_id=v_user and week_start=p_week_start for update;
 if (case when p_expected_version=0 then v_version<>1 else v_version<>p_expected_version end) then
   raise exception 'Kitchen plan changed; reload before saving' using errcode='40001';
 end if;
 delete from public.v2_kitchen_plan_entries
 where user_id=v_user and week_start=p_week_start;
 insert into public.v2_kitchen_plan_entries(
   id,user_id,week_start,eat_date,meal_slot,source_kind,source_id,portions,execution_mode)
 select (x.value->>'id')::uuid,v_user,p_week_start,(x.value->>'eatDate')::date,
   x.value->>'mealSlot',x.value->>'sourceKind',x.value->>'sourceId',
   (x.value->>'portions')::numeric,x.value->>'executionMode'
 from jsonb_array_elements(p_entries) as x(value);
 update public.v2_kitchen_plan_weeks
 set version=v_version+1,updated_at=now()
 where user_id=v_user and week_start=p_week_start;
 insert into allin_private.v2_kitchen_plan_actions(
   user_id,action_id,week_start,payload,result_version)
 values(v_user,p_action_id,p_week_start,p_entries,v_version+1);
 return v_version+1;
end;
$$;
revoke all on function public.v2_kitchen_read_plan_week(uuid,date)
 from public,anon,authenticated,service_role;
revoke all on function public.v2_kitchen_replace_plan_week(uuid,date,bigint,uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_kitchen_read_plan_week(uuid,date) to authenticated;
grant execute on function public.v2_kitchen_replace_plan_week(uuid,date,bigint,uuid,jsonb)
 to authenticated;

-- Review gates before migration: typed Ingredient/Food/Recipe FK admission,
-- action payload equality vs normalized order, full-week CAS contention,
-- Pantry reservation and Shopping invalidation, Auth replay security,
-- ALL-251 owner export/deletion, RLS/role matrix and rollback.
