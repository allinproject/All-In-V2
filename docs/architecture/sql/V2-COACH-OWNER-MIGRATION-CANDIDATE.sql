-- ALL-217 / ALL-222 — V2 Coach owner proposal ONLY; NOT an applied migration.
-- Promote through Supabase CLI migration-new workflow after isolated two-user PG replay.
-- This deliberately contains no model/provider, generic app writer or cost claim RPC.
-- Contract: canonical Coach threads/messages, atomic pair append, owner-scoped read.
create table public.v2_coach_threads (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id,user_id)
);

create table public.v2_coach_messages (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  client_request_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  constraint v2_coach_message_content_length check (
    (role='user' and length(btrim(content)) between 1 and 12000)
    or (role='assistant' and length(btrim(content)) between 1 and 20000)
  ),
  constraint v2_coach_message_thread_owner_fk
    foreign key (thread_id,user_id) references public.v2_coach_threads(id,user_id) on delete cascade,
  -- Stable request identity cannot move between threads for one owner.
  unique (user_id,client_request_id,role)
);

create index v2_coach_messages_owner_thread_recent
  on public.v2_coach_messages (user_id,thread_id,created_at desc,id desc);
create index v2_coach_threads_owner_recent
  on public.v2_coach_threads (user_id,updated_at desc,id desc);

alter table public.v2_coach_threads enable row level security;
alter table public.v2_coach_messages enable row level security;

revoke all on table public.v2_coach_threads from public,anon,authenticated,service_role;
revoke all on table public.v2_coach_messages from public,anon,authenticated,service_role;
grant select on table public.v2_coach_threads to authenticated;
grant select on table public.v2_coach_messages to authenticated;

create policy v2_coach_threads_owner_select on public.v2_coach_threads
  for select to authenticated using ((select auth.uid())=user_id);
create policy v2_coach_messages_owner_select on public.v2_coach_messages
  for select to authenticated using ((select auth.uid())=user_id);

-- Exactly-one owner-bound thread creation; stable supplied UUID supports retry.
create function public.v2_coach_create_thread(p_expected_user_id uuid,p_thread_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid := auth.uid(); v_existing public.v2_coach_threads%rowtype;
begin
  if v_user is null or not exists(select 1 from auth.users where id=v_user)
    or p_expected_user_id is distinct from v_user then
    raise exception 'Active expected V2 owner required' using errcode='42501';
  end if;
  if p_thread_id is null then
    raise exception 'Stable thread identity required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('v2-coach-thread:'||p_thread_id::text,0)
  );
  select * into v_existing from public.v2_coach_threads where id=p_thread_id;
  if found then
    if v_existing.user_id is distinct from v_user or v_existing.archived_at is not null then
      raise exception 'Thread ID unavailable to this account' using errcode='42501';
    end if;
    return p_thread_id;
  end if;
  insert into public.v2_coach_threads(id,user_id) values(p_thread_id,v_user);
  return p_thread_id;
end;
$function$;

revoke all on function public.v2_coach_create_thread(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.v2_coach_create_thread(uuid,uuid) to authenticated;

-- Exactly-once paired exchange: do not give the client table INSERT privileges.
-- Only the JWT-verifying Coach Edge host may invoke this service-role-only
-- writer; the mobile app cannot forge assistant messages through a public RPC.
-- This does not claim a request or authorize model cost. A separate
-- pre-provider request claim/rate gate is required.
create function public.v2_coach_append_exchange(
  p_expected_user_id uuid,
  p_thread_id uuid,
  p_client_request_id uuid,
  p_user_message_id uuid,
  p_assistant_message_id uuid,
  p_user_content text,
  p_assistant_content text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  -- Service-role-only caller must have independently validated bearer JWT and
  -- bound this ID to the authenticated user before privileged invocation.
  v_user uuid := p_expected_user_id;
  v_user_text text := btrim(coalesce(p_user_content,''));
  v_assistant_text text := btrim(coalesce(p_assistant_content,''));
  v_matched integer;
  v_existing integer;
begin
  if v_user is null or not exists(select 1 from auth.users where id=v_user) then
    raise exception 'Active verified V2 owner required' using errcode='42501';
  end if;
  if p_thread_id is null or p_client_request_id is null or
     p_user_message_id is null or p_assistant_message_id is null or
     p_user_message_id=p_assistant_message_id then
    raise exception 'Distinct stable Coach exchange identities required' using errcode='22023';
  end if;
  if length(v_user_text) not between 1 and 12000 or
     length(v_assistant_text) not between 1 and 20000 then
    raise exception 'Coach exchange content invalid' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('v2-coach-exchange:'||v_user::text||':'||p_client_request_id::text,0)
  );
  if not exists(
    select 1 from public.v2_coach_threads t
    where t.id=p_thread_id and t.user_id=v_user and t.archived_at is null
  ) then
    raise exception 'Active Coach thread not owned by account' using errcode='42501';
  end if;

  select count(*) into v_existing from public.v2_coach_messages m
  where m.user_id=v_user and m.client_request_id=p_client_request_id;
  if v_existing not in (0,2) then
    raise exception 'Incomplete Coach exchange requires owner repair' using errcode='22000';
  end if;
  if v_existing=2 then
    select count(*) into v_matched from public.v2_coach_messages m
    where m.user_id=v_user and m.thread_id=p_thread_id
      and m.client_request_id=p_client_request_id
      and ((m.id=p_user_message_id and m.role='user' and m.content=v_user_text)
           or (m.id=p_assistant_message_id and m.role='assistant' and m.content=v_assistant_text));
    if v_matched<>2 then
      raise exception 'Coach request IDs were reused with different content or identity'
        using errcode='22000';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',true,'thread_id',p_thread_id,
      'client_request_id',p_client_request_id,
      'user_message_id',p_user_message_id,
      'assistant_message_id',p_assistant_message_id
    );
  end if;

  insert into public.v2_coach_messages
    (id,user_id,thread_id,client_request_id,role,content)
  values(p_user_message_id,v_user,p_thread_id,p_client_request_id,'user',v_user_text)
  on conflict(id) do nothing;

  insert into public.v2_coach_messages
    (id,user_id,thread_id,client_request_id,role,content)
  values(p_assistant_message_id,v_user,p_thread_id,p_client_request_id,'assistant',v_assistant_text)
  on conflict(id) do nothing;

  select count(*) into v_matched from public.v2_coach_messages m
  where m.user_id=v_user and m.thread_id=p_thread_id
    and m.client_request_id=p_client_request_id
    and (
      (m.id=p_user_message_id and m.role='user' and m.content=v_user_text)
      or
      (m.id=p_assistant_message_id and m.role='assistant' and m.content=v_assistant_text)
    );
  if v_matched<>2 then
    raise exception 'Coach request IDs were reused with different content or identity'
      using errcode='22000';
  end if;
  update public.v2_coach_threads
    set updated_at=now()
  where id=p_thread_id and user_id=v_user;
  return pg_catalog.jsonb_build_object(
    'ok',true,'thread_id',p_thread_id,
    'client_request_id',p_client_request_id,
    'user_message_id',p_user_message_id,
    'assistant_message_id',p_assistant_message_id
  );
end;
$function$;

revoke all on function public.v2_coach_append_exchange(
  uuid,uuid,uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.v2_coach_append_exchange(
  uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

-- Owner-RLS-invoker, bounded cursor pagination (newest first).
create function public.v2_coach_read_messages(
  p_expected_user_id uuid,
  p_thread_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 40
) returns table(
  message_id uuid,user_id uuid,thread_id uuid,client_request_id uuid,
  role text,content text,created_at timestamptz
) language plpgsql stable security invoker set search_path=''
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_expected_user_id is distinct from v_user then
    raise exception 'Expected V2 owner required' using errcode='42501';
  end if;
  if p_thread_id is null or p_limit is null or p_limit not between 1 and 50
    or ((p_before_created_at is null) <> (p_before_message_id is null)) then
    raise exception 'Invalid Coach transcript window' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.v2_coach_threads t
    where t.id=p_thread_id and t.user_id=v_user
  ) then
    raise exception 'Coach thread not owned by account' using errcode='42501';
  end if;
  return query select m.id,m.user_id,m.thread_id,m.client_request_id,
    m.role,m.content,m.created_at
  from public.v2_coach_messages m
  where m.user_id=v_user and m.thread_id=p_thread_id
    and (p_before_created_at is null or
         (m.created_at,m.id)<(p_before_created_at,p_before_message_id))
  order by m.created_at desc,m.id desc
  limit p_limit;
end;
$function$;

revoke all on function public.v2_coach_read_messages(uuid,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.v2_coach_read_messages(uuid,uuid,timestamptz,uuid,integer)
  to authenticated;

comment on table public.v2_coach_threads is 'V2 owner-scoped Coach conversation identity; no business-domain facts.';
comment on table public.v2_coach_messages is 'Immutable owner-thread Coach transcript; paired writes only through canonical owner RPC.';
notify pgrst, 'reload schema';
