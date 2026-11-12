-- ALL-247: REVIEW-ONLY daily nutrition budget reader.
-- Requires canonical V2 public.v2_profile_settings and ALL-247 Food Log candidates.
-- Intentionally DOES NOT write a second nutrition goal, completion ledger or exercise calorie store.
-- Historic days use CURRENT preferences; do not present this as historical target reconstruction.
-- No unverified complete-day totals or exercise adjustment is asserted.
create function public.v2_fuel_daily_energy_snapshot(
 p_expected_user_id uuid,
 p_local_date date
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $fn$
declare
 v_actor uuid := auth.uid();
 v_settings jsonb;
 v_settings_version bigint;
 v_preferences jsonb;
 v_mode text;
 v_policy text;
 v_enabled boolean;
 v_raw_target text;
 v_target numeric;
 v_count bigint;
 v_unknown bigint;
 v_logged numeric;
 v_status text;
 v_provisional numeric;
begin
 if v_actor is null or p_expected_user_id is null or v_actor <> p_expected_user_id then
   raise exception 'Expected account is not authenticated' using errcode='42501';
 end if;
 if p_local_date is null then
   raise exception 'Local day required' using errcode='22023';
 end if;
 select s.settings, s.version into v_settings,v_settings_version
   from public.v2_profile_settings s where s.user_id=v_actor;
 if not found then
   raise exception 'Profile settings unavailable' using errcode='P0002';
 end if;
 v_preferences := v_settings->'nutrition_preferences';
 if pg_catalog.jsonb_typeof(v_preferences) is distinct from 'object' then
   v_preferences := '{}'::jsonb;
 end if;
 v_mode:=v_preferences->>'fuel_tracking_mode';
 v_policy:=v_preferences->>'activity_adjustment_policy';
 v_enabled:=v_preferences->'energy_goal_enabled' = 'true'::jsonb;
 if v_mode is null then v_mode:='unconfigured'; end if;
 if v_policy is null then v_policy:='unconfigured'; end if;
 -- Accept a numeric target ONLY when explicitly enabled and verified by typed constraints.
 -- Unrecognized/invalid settings fail closed. This reader never silently sets goals.
 if v_mode='detailed' and v_enabled and
    pg_catalog.jsonb_typeof(v_preferences->'daily_energy_target_kcal')='number' then
   v_raw_target:=v_preferences->>'daily_energy_target_kcal';
   if v_raw_target ~ '^[0-9]{1,5}([.][0-9]{1,3})?$' then
     v_target:=v_raw_target::numeric;
     if v_target<=0 or v_target>20000 then v_target:=null; end if;
   end if;
 end if;
 select count(*)::bigint,count(*) filter (where e.kcal is null)::bigint,sum(e.kcal)
 into v_count,v_unknown,v_logged
 from public.v2_food_log_entries e
 where e.user_id=v_actor and e.local_date=p_local_date and e.deleted_at is null;
 -- User may consume things not entered. Even with a valid goal and all recorded kcal
 -- known, there is no approved COMPLETE-DAY confirmation yet.
 v_status:='not_configured';
 if v_mode='behavior_only' then
   v_status:='behavior_only';
 elsif v_mode='detailed' then
   if not v_enabled or v_target is null or v_policy not in ('off','verified_activity') then
     v_status:='goal_unavailable';
   elsif v_policy='verified_activity' then
     v_status:='activity_energy_source_pending';
   elsif v_count=0 then
     v_status:='no_logged_intake';
   elsif v_unknown>0 then
     v_status:='incomplete_logged_nutrition';
   else
     v_status:='logged_only_provisional';
     v_provisional:=v_target-v_logged;
   end if;
 end if;
 return pg_catalog.jsonb_build_object(
  'date',p_local_date,
  'source','canonical_food_log_and_current_profile_settings',
  'settings_version',v_settings_version,
  'tracking_mode',v_mode,
  'status',v_status,
  'entry_count',v_count,
  'unknown_calorie_entry_count',case when v_mode='behavior_only' then null else v_unknown end,
  'logged_kcal_subtotal',case when v_mode='behavior_only' then null else v_logged end,
  'daily_target_kcal',v_target,
  'activity_adjustment_policy',v_policy,
  'verified_activity_kcal',null,
  'provisional_target_minus_logged_kcal',v_provisional,
  'confirmed_remaining_kcal',null,
  'day_intake_completeness','unconfirmed',
  'goal_historical_accuracy','current_settings_only'
 );
end
$fn$;
revoke all on function public.v2_fuel_daily_energy_snapshot(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_fuel_daily_energy_snapshot(uuid,date)
 to authenticated;
