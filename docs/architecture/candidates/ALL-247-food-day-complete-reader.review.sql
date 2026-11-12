-- ALL-247 REVIEW ONLY. One canonical Food Log, full-day read endpoint.
-- Depends on food-log first-writer + lifecycle SQL; NEVER a second diary.
-- A read is complete only if all active rows fit the hard day limit.
create function public.v2_food_log_read_complete_day(
 p_expected_user_id uuid,
 p_local_date date
) returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare
 v_actor uuid:=auth.uid();
 v_count bigint;
 v_entries jsonb;
 v_revision text;
begin
 if v_actor is null or p_expected_user_id is null
    or v_actor<>p_expected_user_id then
   raise exception 'Food Log reader account mismatch' using errcode='42501';
 end if;
 if p_local_date is null then
   raise exception 'Food Log day required' using errcode='22023';
 end if;
 -- One MVCC statement reads all rows of the owner/day, capped by refusal.
 -- Do NOT mark the first N rows of a longer day as complete.
 with bounded as materialized (
   select id,user_id,consumed_at,local_date,timezone_name,meal_slot,label,
          quantity,unit,kcal,nutrition_source,created_at,deleted_at,revision,updated_at
   from public.v2_food_log_entries
   where user_id=v_actor and local_date=p_local_date and deleted_at is null
   order by consumed_at,id
   limit 257
 )
 select count(*)::bigint,
        coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id',b.id,'user_id',b.user_id,
            'consumed_at',b.consumed_at,'local_date',b.local_date,
            'timezone_name',b.timezone_name,
            'meal_slot',b.meal_slot,'label',b.label,
            'quantity',b.quantity,'unit',b.unit,'kcal',b.kcal,
            'nutrition_source',b.nutrition_source,
            'created_at',b.created_at,'deleted_at',b.deleted_at,
            'revision',b.revision
          ) order by b.consumed_at,b.id
        ),'[]'::jsonb),
        pg_catalog.md5(coalesce(
         (pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
           b.id,b.revision,b.consumed_at,b.local_date,b.deleted_at,b.updated_at
         ) order by b.consumed_at,b.id))::text,'[]'
        ))
 into v_count,v_entries,v_revision
 from bounded b;
 if v_count>256 then
   raise exception 'Food Log day exceeds verified complete-reader limit'
     using errcode='54000';
 end if;
 return pg_catalog.jsonb_build_object(
  'ownerId',v_actor,'localDate',p_local_date,
  'sourceRevision','fuel-food-day-v1:'||v_revision,
  'complete',true,'entries',v_entries);
end
$fn$;
revoke all on function public.v2_food_log_read_complete_day(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_food_log_read_complete_day(uuid,date) to authenticated;
