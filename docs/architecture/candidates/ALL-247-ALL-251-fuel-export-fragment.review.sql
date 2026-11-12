-- ALL-247 / ALL-251 REVIEW ONLY: canonical Fuel fragment for existing owner export.
-- NOT a new export pipeline. Owner export must invoke this only after its own
-- approved request/session/retention and consistent-snapshot checks.
-- Include tombstones and action receipts for full account data portability.
-- Prerequisite: ALL-247 Food Log + Hydration candidates installed on disposable DB.
create function public.v2_account_export_fuel_fragment_review(
 p_expected_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare
 v_actor uuid := auth.uid();
begin
 if v_actor is null or p_expected_user_id is null or v_actor<>p_expected_user_id
    or not exists(select 1 from auth.users where id=v_actor) then
    raise exception 'Account owner required for Fuel fragment' using errcode='42501';
 end if;
 -- This is a nested fragment, not a public entrypoint. SQL direct privileges
 -- are limited; canonical ALL-251 request-level approval is still essential.
 return pg_catalog.jsonb_build_object(
  'version','fuel_owner_v1',
  'food_entries',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.created_at,e.id)
     from public.v2_food_log_entries e where e.user_id=v_actor),'[]'::jsonb),
  'food_actions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.created_at,a.action_id)
     from allin_private.v2_food_log_write_actions a where a.user_id=v_actor),'[]'::jsonb),
  'hydration_events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.created_at,h.id)
     from public.v2_hydration_events h where h.user_id=v_actor),'[]'::jsonb),
  'hydration_actions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.created_at,a.action_id)
     from allin_private.v2_hydration_actions a where a.user_id=v_actor),'[]'::jsonb)
 );
end
$fn$;
revoke all on function public.v2_account_export_fuel_fragment_review(uuid)
 from public,anon,authenticated,service_role;
-- NO EXECUTE grant: canonical ALL-251 integration must explicitly bind a
-- reviewed backend/export principal. Caller under a different database function
-- owner also requires approved function invocation privilege.
