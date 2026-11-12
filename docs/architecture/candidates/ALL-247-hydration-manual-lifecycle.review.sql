-- ALL-247 / ALL-47: REVIEW-ONLY manual hydration lifecycle candidate.
-- Depends on V2 auth.users, auth.uid(), public/allin_private schemas.
-- No permanent deploy without ALL-222 schema/RLS and ALL-251 lifecycle review.
-- One Fuel-owned hydration stream: no second calorie/water diary.
create table public.v2_hydration_events (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 occurred_at timestamptz not null,
 local_date date not null,
 timezone_name text not null,
 event_kind text not null check(event_kind in ('drink','refill')),
 source_platform text not null default 'manual' check(source_platform='manual'),
 source_name text not null default 'ALL IN 365 manual' check(source_name='ALL IN 365 manual'),
 confidence text not null default 'user_confirmed' check(confidence='user_confirmed'),
 original_volume numeric(12,4) not null check(original_volume>0),
 original_unit text not null check(original_unit in ('ml','l','us_fl_oz')),
 volume_ml numeric(15,3) not null check(volume_ml>0),
 revision bigint not null default 1 check(revision>0),
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint v2_hydration_timezone_length check(length(timezone_name) between 1 and 80)
);
create index v2_hydration_owner_day_idx on public.v2_hydration_events(user_id,local_date,occurred_at,id) where deleted_at is null;
alter table public.v2_hydration_events enable row level security;
revoke all on public.v2_hydration_events from public,anon,authenticated,service_role;
grant select on public.v2_hydration_events to authenticated;
create policy v2_hydration_owner_read on public.v2_hydration_events
 for select to authenticated using ((select auth.uid())=user_id and deleted_at is null);
create table allin_private.v2_hydration_actions (
 user_id uuid not null references auth.users(id) on delete cascade,
 action_id uuid not null,
 request_fingerprint text not null,
 result_id uuid not null,
 result_revision bigint not null,
 created_at timestamptz not null default now(),
 primary key(user_id,action_id)
);
alter table allin_private.v2_hydration_actions enable row level security;
revoke all on allin_private.v2_hydration_actions from public,anon,authenticated,service_role;

create function public.v2_hydration_mutate_manual(
 p_expected_user_id uuid,
 p_action_id uuid,
 p_event_id uuid,
 p_operation text,
 p_expected_revision bigint default null,
 p_occurred_at timestamptz default null,
 p_local_date date default null,
 p_timezone_name text default null,
 p_event_kind text default null,
 p_volume numeric default null,
 p_unit text default null
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid := auth.uid();
 v_hash text;
 v_old allin_private.v2_hydration_actions%rowtype;
 v_current public.v2_hydration_events%rowtype;
 v_ml numeric(15,3);
 v_revision bigint;
begin
 if v_actor is null or p_expected_user_id is null or v_actor <> p_expected_user_id then
  raise exception 'Expected account is not authenticated' using errcode='42501';
 end if;
 if p_action_id is null or p_event_id is null or p_operation is null or
   p_operation not in ('add','edit','move','delete') or
   (p_operation='add' and p_expected_revision is not null) or
   (p_operation<>'add' and (p_expected_revision is null or p_expected_revision<1)) then
  raise exception 'Invalid hydration operation identity or revision' using errcode='22023';
 end if;
 if p_operation='delete' then
   if p_occurred_at is not null or p_local_date is not null or p_timezone_name is not null or
     p_event_kind is not null or p_volume is not null or p_unit is not null then
     raise exception 'Delete cannot include replacement fields' using errcode='22023';
   end if;
 else
   if p_occurred_at is null or p_local_date is null or p_timezone_name is null or
      length(p_timezone_name) not between 1 and 80 or
      p_event_kind is null or p_event_kind not in ('drink','refill') or
      p_volume is null or p_volume<=0 or p_volume>1000000 or
      p_unit is null or p_unit not in ('ml','l','us_fl_oz') then
     raise exception 'Invalid hydration event payload' using errcode='22023';
   end if;
   -- Require a real PostgreSQL IANA time zone name; no silent arbitrary offset.
   if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone_name) then
     raise exception 'Unsupported hydration timezone' using errcode='22023';
   end if;
   if p_local_date is distinct from (p_occurred_at at time zone p_timezone_name)::date then
     raise exception 'Hydration day differs from timestamp/timezone' using errcode='22023';
   end if;
   v_ml := round((p_volume * case p_unit
                   when 'ml' then 1::numeric
                   when 'l' then 1000::numeric
                   else 29.5735295625::numeric end)::numeric, 3);
   if v_ml<=0 then raise exception 'Hydration volume too small' using errcode='22023'; end if;
 end if;
 v_hash := pg_catalog.md5(pg_catalog.jsonb_build_array(
 'ALL-247-hydration-v1',p_event_id,p_operation,p_expected_revision,
 p_occurred_at,p_local_date,p_timezone_name,p_event_kind,p_volume,p_unit
 )::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,248));
 select * into v_old from allin_private.v2_hydration_actions
  where user_id=v_actor and action_id=p_action_id;
 if found then
   if v_old.request_fingerprint <> v_hash or v_old.result_id <> p_event_id then
     raise exception 'Hydration action ID reused with changed payload' using errcode='22000';
   end if;
   return pg_catalog.jsonb_build_object('id',v_old.result_id,'revision',v_old.result_revision,'replayed',true);
 end if;
 if p_operation='add' then
   insert into public.v2_hydration_events
    (id,user_id,occurred_at,local_date,timezone_name,event_kind,original_volume,original_unit,volume_ml)
   values (p_event_id,v_actor,p_occurred_at,p_local_date,p_timezone_name,p_event_kind,p_volume,p_unit,v_ml);
   v_revision:=1;
 else
   select * into v_current from public.v2_hydration_events
     where user_id=v_actor and id=p_event_id for update;
   if not found then
     raise exception 'Hydration event not found' using errcode='P0002';
   end if;
   if v_current.deleted_at is not null or v_current.revision <> p_expected_revision then
     raise exception 'Hydration revision stale or deleted' using errcode='40001';
   end if;
   if p_operation='move' and (
     p_event_kind is distinct from v_current.event_kind or
     p_volume is distinct from v_current.original_volume or
     p_unit is distinct from v_current.original_unit
   ) then
     raise exception 'Move cannot change hydration amount or type' using errcode='22023';
   end if;
   if p_operation='delete' then
     update public.v2_hydration_events
      set deleted_at=now(),revision=revision+1,updated_at=now()
      where user_id=v_actor and id=p_event_id and revision=p_expected_revision
      returning revision into v_revision;
   else
     update public.v2_hydration_events
      set occurred_at=p_occurred_at,local_date=p_local_date,timezone_name=p_timezone_name,
          event_kind=p_event_kind,original_volume=p_volume,original_unit=p_unit,
          volume_ml=v_ml,revision=revision+1,updated_at=now()
      where user_id=v_actor and id=p_event_id and revision=p_expected_revision
      returning revision into v_revision;
   end if;
   if v_revision is null then raise exception 'Hydration changed; reload' using errcode='40001'; end if;
 end if;
 insert into allin_private.v2_hydration_actions(user_id,action_id,request_fingerprint,result_id,result_revision)
 values(v_actor,p_action_id,v_hash,p_event_id,v_revision);
 return pg_catalog.jsonb_build_object('id',p_event_id,'revision',v_revision,'replayed',false);
end $fn$;
revoke all on function public.v2_hydration_mutate_manual(
 uuid,uuid,uuid,text,bigint,timestamptz,date,text,text,numeric,text
) from public,anon,authenticated,service_role;
grant execute on function public.v2_hydration_mutate_manual(
 uuid,uuid,uuid,text,bigint,timestamptz,date,text,text,numeric,text
) to authenticated;

-- Every returned volume is a subtotal of recorded, confirmed drinks; a missing day is unknown.
-- Refills remain visible as events but do not count toward consumption.
create function public.v2_hydration_daily_history(p_start date,p_end date)
 returns table(day date,drink_count bigint,refill_count bigint,confirmed_drink_ml numeric,coverage text)
 language sql stable security invoker set search_path=''
as $fn$
 select e.local_date,count(*) filter(where e.event_kind='drink')::bigint,
 count(*) filter(where e.event_kind='refill')::bigint,
 sum(e.volume_ml) filter(where e.event_kind='drink')::numeric,
 'logged_events_only'::text
 from public.v2_hydration_events e
 where e.user_id=auth.uid() and e.deleted_at is null
   and p_start is not null and p_end is not null
   and p_end>=p_start and p_end<=p_start+366
   and e.local_date between p_start and p_end
 group by e.local_date order by e.local_date
$fn$;
revoke all on function public.v2_hydration_daily_history(date,date)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_hydration_daily_history(date,date) to authenticated;
