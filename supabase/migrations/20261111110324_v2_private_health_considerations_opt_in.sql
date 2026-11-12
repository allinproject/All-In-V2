
-- V2 only: private, user-controlled health considerations. Never stored in generic profile settings.
create table if not exists allin_private.v2_health_considerations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  conditions jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  coach_opt_in boolean not null default false,
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  constraint v2_health_conditions_array check (jsonb_typeof(conditions)='array'),
  constraint v2_health_limitations_array check (jsonb_typeof(limitations)='array')
);
alter table allin_private.v2_health_considerations enable row level security;
revoke all on allin_private.v2_health_considerations from public,anon,authenticated,service_role;
-- Only vetted RPCs may access this table. No table RLS policy and no schema usage for clients.
create or replace function public.v2_my_health_considerations(p_expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_row allin_private.v2_health_considerations%rowtype;
begin
 if v_user is null or p_expected_user_id is distinct from v_user then
  raise exception 'Health records require the active account' using errcode='42501';
 end if;
 select * into v_row from allin_private.v2_health_considerations where user_id=v_user;
 if not found then return jsonb_build_object('conditions','[]'::jsonb,'limitations','[]'::jsonb,'coach_opt_in',false,'version',0); end if;
 return jsonb_build_object('conditions',v_row.conditions,'limitations',v_row.limitations,
  'coach_opt_in',v_row.coach_opt_in,'version',v_row.version);
end;$$;
revoke all on function public.v2_my_health_considerations(uuid) from public,anon,authenticated,service_role;
grant execute on function public.v2_my_health_considerations(uuid) to authenticated;

create or replace function public.v2_save_health_considerations(
 p_expected_user_id uuid, p_conditions jsonb, p_limitations jsonb,
 p_coach_opt_in boolean, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_row allin_private.v2_health_considerations%rowtype;
 v_next bigint;
begin
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
end;$$;
revoke all on function public.v2_save_health_considerations(uuid,jsonb,jsonb,boolean,bigint)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_save_health_considerations(uuid,jsonb,jsonb,boolean,bigint)
 to authenticated;
comment on table allin_private.v2_health_considerations is
 'Private owner-scoped health considerations; Coach access not implemented, consent is opt-in and revocable.';
