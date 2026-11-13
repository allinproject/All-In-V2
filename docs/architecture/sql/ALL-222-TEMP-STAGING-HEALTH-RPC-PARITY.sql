-- Isolated ALL-222 temporary staging only. Exact source copied from canonical V2 pg_get_functiondef.
-- Preserves all existing staging domains, RPCs, deletion and Storage gate settings.

CREATE OR REPLACE FUNCTION public.v2_my_health_considerations(p_expected_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_health_considerations%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Health records require the active account' using errcode='42501';
 end if;
 select * into v_row from allin_private.v2_health_considerations where user_id=v_user;
 if not found then return jsonb_build_object('conditions','[]'::jsonb,'limitations','[]'::jsonb,'coach_opt_in',false,'version',0); end if;
 return jsonb_build_object('conditions',v_row.conditions,'limitations',v_row.limitations,
  'coach_opt_in',v_row.coach_opt_in,'version',v_row.version);
end;$function$

REVOKE ALL ON FUNCTION public.v2_my_health_considerations(p_expected_user_id uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.v2_my_health_considerations(p_expected_user_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.v2_save_health_considerations(p_expected_user_id uuid, p_conditions jsonb, p_limitations jsonb, p_coach_opt_in boolean, p_expected_version bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := auth.uid(); v_row allin_private.v2_health_considerations%rowtype;
 v_next bigint;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Health records require the active account' using errcode='42501';
 end if;
 if p_expected_version is null or p_expected_version < 0 then
  raise exception 'Expected health record version required' using errcode='22023';
 end if;
 if p_coach_opt_in is null then
  raise exception 'Coach consent must be explicit' using errcode='22023';
 end if;
 if p_conditions is null or p_limitations is null
   or jsonb_typeof(p_conditions)<>'array' or jsonb_typeof(p_limitations)<>'array'
   or jsonb_array_length(p_conditions)>12 or jsonb_array_length(p_limitations)>12 then
  raise exception 'Invalid health record arrays' using errcode='22023';
 end if;
 if exists (
  select 1 from jsonb_array_elements(p_conditions) as item(value)
  where jsonb_typeof(item.value)<>'string'
  or length(btrim(item.value #>> '{}')) not between 1 and 180
 ) or exists (
  select 1 from jsonb_array_elements(p_limitations) as item(value)
  where jsonb_typeof(item.value)<>'string'
  or length(btrim(item.value #>> '{}')) not between 1 and 180
 ) then raise exception 'Invalid health record text' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('v2-health:'||v_user::text,0));
 select * into v_row from allin_private.v2_health_considerations where user_id=v_user for update;
 if not found then
  if p_expected_version<>0 then
   raise exception 'Health record changed; reload before retrying' using errcode='40001';
  end if;
  insert into allin_private.v2_health_considerations
   (user_id,conditions,limitations,coach_opt_in)
  values (v_user,p_conditions,p_limitations,p_coach_opt_in)
  returning version into v_next;
 else
  if v_row.version<>p_expected_version then
   raise exception 'Health record changed; reload before retrying' using errcode='40001';
  end if;
  update allin_private.v2_health_considerations
   set conditions=p_conditions,limitations=p_limitations,coach_opt_in=p_coach_opt_in,
   version=version+1,updated_at=now()
   where user_id=v_user returning version into v_next;
 end if;
 return v_next;
end;$function$

REVOKE ALL ON FUNCTION public.v2_save_health_considerations(p_expected_user_id uuid, p_conditions jsonb, p_limitations jsonb, p_coach_opt_in boolean, p_expected_version bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.v2_save_health_considerations(p_expected_user_id uuid, p_conditions jsonb, p_limitations jsonb, p_coach_opt_in boolean, p_expected_version bigint) TO authenticated;
