
-- ALL-247 lifecycle extension: the original add writer and ledger stay authoritative.
alter table public.v2_food_log_entries
 add column deleted_at timestamptz,
 add column updated_at timestamptz not null default now();
create index v2_food_log_entries_active_day_idx
 on public.v2_food_log_entries(user_id,local_date)
 where deleted_at is null;

-- All edit/move/delete operations are complete, versioned replacements or tombstones.
-- Operation-specific replay remains in the existing private action ledger.
create function public.v2_food_log_mutate_manual(
 p_expected_user_id uuid,
 p_action_id uuid,
 p_entry_id uuid,
 p_expected_revision bigint,
 p_operation text,
 p_consumed_at timestamptz default null,
 p_local_date date default null,
 p_timezone_name text default null,
 p_meal_slot text default null,
 p_label text default null,
 p_quantity numeric default null,
 p_unit text default null,
 p_kcal numeric default null,
 p_nutrition_source text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
 v_actor uuid := auth.uid();
 v_hash text;
 v_old allin_private.v2_food_log_write_actions%rowtype;
 v_current public.v2_food_log_entries%rowtype;
 v_next bigint;
begin
 if v_actor is null or p_expected_user_id is null or v_actor <> p_expected_user_id then
   raise exception 'Not authorized for expected account' using errcode = '42501';
 end if;
 if p_action_id is null or p_entry_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_operation not in ('edit','move','delete') or p_operation is null then
   raise exception 'Invalid food log mutation identity or operation' using errcode = '22023';
 end if;
 -- A move is an exact replacement of the original event's temporal/meal attribution.
 -- The caller supplies its complete currently reviewed nutrition and quantity snapshot,
 -- so no silent calculation, omission, or new default can corrupt the event.
 if p_operation <> 'delete' and (
   p_consumed_at is null or p_local_date is null or
   p_timezone_name is null or length(p_timezone_name) not between 1 and 80 or
   p_meal_slot is null or p_meal_slot not in ('breakfast','lunch','dinner','snack','other') or
   p_label is null or length(btrim(p_label)) not between 1 and 200 or
   p_quantity is null or p_quantity <= 0 or p_quantity > 9999999999 or
   p_unit is null or p_unit not in ('g','ml','oz','fl_oz','serving','each') or
   p_nutrition_source is null or p_nutrition_source not in ('user_entered','unknown') or
   (p_nutrition_source='unknown' and p_kcal is not null) or p_kcal < 0 or
   p_local_date is distinct from (p_consumed_at at time zone p_timezone_name)::date
 ) then
   raise exception 'Invalid food log event replacement' using errcode = '22023';
 end if;
 if p_operation = 'delete' and (
   p_consumed_at is not null or p_local_date is not null or
   p_timezone_name is not null or p_meal_slot is not null or p_label is not null or
   p_quantity is not null or p_unit is not null or p_kcal is not null or p_nutrition_source is not null
 ) then
   raise exception 'Delete must not include an event replacement' using errcode = '22023';
 end if;
 v_hash := pg_catalog.md5(jsonb_build_array(
   'ALL-247-lifecycle-v1',p_operation,p_entry_id,p_expected_revision,p_consumed_at,
   p_local_date,p_timezone_name,p_meal_slot,p_label,p_quantity,p_unit,p_kcal,p_nutrition_source
 )::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,247));
 select * into v_old from allin_private.v2_food_log_write_actions
 where user_id = v_actor and action_id = p_action_id;
 if found then
   if v_old.request_fingerprint <> v_hash or v_old.result_id <> p_entry_id then
     raise exception 'Action ID reused with different event or payload' using errcode='22000';
   end if;
   return pg_catalog.jsonb_build_object('id',v_old.result_id,'revision',v_old.result_revision,'replayed',true);
 end if;
 select * into v_current from public.v2_food_log_entries
 where user_id=v_actor and id=p_entry_id for update;
 if not found then
   raise exception 'Food event does not exist for this account' using errcode='P0002';
 end if;
 if v_current.deleted_at is not null or v_current.revision <> p_expected_revision then
   raise exception 'Food event revision is stale or deleted; reload' using errcode='40001';
 end if;
 if p_operation = 'move' and (
  p_label is distinct from v_current.label or p_quantity is distinct from v_current.quantity or
  p_unit is distinct from v_current.unit or p_kcal is distinct from v_current.kcal or
  p_nutrition_source is distinct from v_current.nutrition_source
 ) then
   raise exception 'Move may only change day, timestamp, timezone or meal slot' using errcode='22023';
 end if;
 if p_operation='delete' then
   update public.v2_food_log_entries
   set deleted_at=now(), revision=revision+1, updated_at=now()
   where user_id=v_actor and id=p_entry_id and revision=p_expected_revision
   returning revision into v_next;
 else
   update public.v2_food_log_entries
   set consumed_at=p_consumed_at,local_date=p_local_date,timezone_name=p_timezone_name,
       meal_slot=p_meal_slot,label=p_label,quantity=p_quantity,unit=p_unit,kcal=p_kcal,
       nutrition_source=p_nutrition_source,revision=revision+1,updated_at=now()
   where user_id=v_actor and id=p_entry_id and revision=p_expected_revision
   returning revision into v_next;
 end if;
 if v_next is null then
   raise exception 'Food event changed; reload before retry' using errcode='40001';
 end if;
 insert into allin_private.v2_food_log_write_actions(user_id,action_id,request_fingerprint,result_id,result_revision)
 values (v_actor,p_action_id,v_hash,p_entry_id,v_next);
 return pg_catalog.jsonb_build_object('id',p_entry_id,'revision',v_next,'replayed',false);
end $fn$;
revoke all on function public.v2_food_log_mutate_manual(
 uuid,uuid,uuid,bigint,text,timestamptz,date,text,text,text,numeric,text,numeric,text
) from public,anon,authenticated,service_role;
grant execute on function public.v2_food_log_mutate_manual(
 uuid,uuid,uuid,bigint,text,timestamptz,date,text,text,text,numeric,text,numeric,text
) to authenticated;

-- Derived, never cached: moving or deleting an entry changes both days at the next read.
-- No entries -> null subtotal, NOT an assertion that the user consumed zero.
-- A day can still have unlogged food even if all persisted events have known energy.
create function public.v2_food_log_day_subtotals(p_start date, p_end date)
 returns table(local_date date, entry_count bigint, known_kcal_subtotal numeric,
               unknown_kcal_count bigint, energy_coverage text)
 language sql stable security invoker set search_path=''
as $fn$
 select e.local_date, count(*)::bigint,
        sum(e.kcal) as known_kcal_subtotal,
        count(*) filter (where e.kcal is null)::bigint,
        case when count(*) filter (where e.kcal is null)>0 then 'partial'
             else 'logged_entries_only' end::text
 from public.v2_food_log_entries e
 where e.user_id=auth.uid() and e.deleted_at is null
   and e.local_date between p_start and p_end
   and p_start is not null and p_end is not null
   and p_end >= p_start and p_end <= p_start + 366
 group by e.local_date order by e.local_date
$fn$;
revoke all on function public.v2_food_log_day_subtotals(date,date)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_food_log_day_subtotals(date,date) to authenticated;
