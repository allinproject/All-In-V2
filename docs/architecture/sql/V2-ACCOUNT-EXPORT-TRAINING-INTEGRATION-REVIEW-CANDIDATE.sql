-- ALL-251 / ALL-243 / ALL-222 REVIEW ONLY: existing account-export RPC with
-- the Training/Activity and Coach owner data integrated. NOT A MIGRATION.
-- Requires owner-approved new Training tables, private fragment and
-- replacement mobile snapshot schema handling BEFORE any release.
-- Generated from current canonical ALL-251 function, not a new API.
-- ALL-251: account-scoped snapshot of CURRENT V2 user-owned data.
-- Deliberately refuse export when new unhandled user tables/Storage appear.
-- This is a backend data snapshot, NOT yet a finished downloadable export.
create or replace function public.v2_export_my_account_snapshot(p_expected_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid();
 v_export jsonb;
 v_goals jsonb;
 v_eventhub jsonb;
 v_community jsonb;
 v_relation record;
begin
 if v_user is null or p_expected_user_id is distinct from v_user
   or not exists(select 1 from auth.users where id=v_user) then
   raise exception 'Active account ownership required for export' using errcode='42501';
 end if;
 if exists(select 1 from storage.buckets) then
   raise exception 'Account export needs Storage coverage before use' using errcode='42501';
 end if;
 if exists (
   select 1 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid
      and a.attname='user_id' and a.attnum>0 and not a.attisdropped
   where n.nspname in ('public','allin_private') and c.relkind in ('r','p')
     and not (
       (n.nspname='public' and c.relname=any(array[
         'v2_profiles','v2_profile_settings','v2_onboarding_progress','v2_legal_acceptances',
         'v2_coach_threads','v2_coach_messages',
         'v2_goals','v2_goal_revisions','v2_goal_revision_behavior_targets',
         'v2_event_group_memberships','v2_event_participations'
       ]))
       or (n.nspname='allin_private' and c.relname=any(array[
         'v2_health_considerations','v2_profile_settings_actions','v2_onboarding_actions',
         'v2_account_deletion_requests','v2_account_deletion_execution_audit',
         'v2_community_visibility','v2_goal_acceptance_actions',
         'v2_goal_approval_reviews','v2_event_group_actions'
       ]))
       or (n.nspname='public' and c.relname=any(array[
         'v2_training_session_instances','v2_completed_activities','v2_activity_sources',
         'v2_training_plans','v2_training_plan_revisions','v2_training_session_slots',
         'v2_training_revision_days','v2_training_revision_sessions',
         'v2_training_execution_events','v2_activity_metric_values',
         'v2_activity_segments','v2_activity_strength_sets','v2_activity_series',
         'v2_activity_route_objects','v2_indoor_weekly_attempts',
         'v2_indoor_weekly_leaderboard','v2_indoor_weekly_achievements'
       ]))
       or (n.nspname='allin_private' and c.relname=any(array[
         'v2_training_action_receipts','v2_training_completion_outbox',
         'v2_coach_message_actions',
         'v2_training_plan_accept_receipts','v2_account_export_requests_candidate'
       ]))
     )
 ) then
   raise exception 'New personal data tables require export coverage' using errcode='42501';
 end if;

 -- Only include this domain when its FULL reviewed candidate graph exists.
 -- Missing half a domain is not an empty export: reject it.
 if exists(select 1 from (values
   ('public.v2_goals'),
   ('public.v2_goal_revisions'),
   ('public.v2_goal_revision_behavior_targets'),
   ('allin_private.v2_goal_acceptance_actions'),
   ('allin_private.v2_goal_approval_reviews')
 ) as expected(relation_name)
 where pg_catalog.to_regclass(expected.relation_name) is not null) then
   if exists(select 1 from (values
     ('public.v2_goals'),
     ('public.v2_goal_revisions'),
     ('public.v2_goal_revision_behavior_targets'),
     ('allin_private.v2_goal_acceptance_actions'),
     ('allin_private.v2_goal_approval_reviews')
   ) as expected(relation_name)
   where pg_catalog.to_regclass(expected.relation_name) is null) then
     raise exception 'Partial goals export domain schema' using errcode='42501';
   end if;
   select jsonb_build_object(
     'goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.id)
       from public.v2_goals g where g.user_id=v_user),'[]'::jsonb),
     'revisions',coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
       from public.v2_goal_revisions r where r.user_id=v_user),'[]'::jsonb),
     'behavior_targets',coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
       from public.v2_goal_revision_behavior_targets t where t.user_id=v_user),'[]'::jsonb),
     'acceptance_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.action_id)
       from allin_private.v2_goal_acceptance_actions a where a.user_id=v_user),'[]'::jsonb),
     'approval_reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
       from allin_private.v2_goal_approval_reviews r where r.user_id=v_user),'[]'::jsonb)
   ) into v_goals;
 end if;
 -- Only include this domain when its FULL reviewed candidate graph exists.
 -- Missing half a domain is not an empty export: reject it.
 if exists(select 1 from (values
   ('public.v2_event_group_memberships'),
   ('public.v2_event_participations'),
   ('allin_private.v2_event_group_actions')
 ) as expected(relation_name)
 where pg_catalog.to_regclass(expected.relation_name) is not null) then
   if exists(select 1 from (values
     ('public.v2_event_group_memberships'),
     ('public.v2_event_participations'),
     ('allin_private.v2_event_group_actions')
   ) as expected(relation_name)
   where pg_catalog.to_regclass(expected.relation_name) is null) then
     raise exception 'Partial eventhub export domain schema' using errcode='42501';
   end if;
   select jsonb_build_object(
     'group_memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.group_id)
       from public.v2_event_group_memberships m where m.user_id=v_user),'[]'::jsonb),
     'participations',coalesce((select jsonb_agg(to_jsonb(p) order by p.event_id)
       from public.v2_event_participations p where p.user_id=v_user),'[]'::jsonb),
     'group_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.action_id)
       from allin_private.v2_event_group_actions a where a.user_id=v_user),'[]'::jsonb)
   ) into v_eventhub;
 end if;
 -- Only include this domain when its FULL reviewed candidate graph exists.
 -- Missing half a domain is not an empty export: reject it.
 -- A new directional Community table may not have a user_id column.
 -- Refuse to export as if complete until its privacy/ownership contract is
 -- reviewed and integrated here (same canonical export entrypoint).
 if exists (
   select 1 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='allin_private' and c.relkind in ('r','p')
     and c.relname like 'v2_community_%'
     and c.relname <> all(array[
       'v2_community_visibility','v2_community_pair_revisions',
       'v2_community_follows','v2_community_blocks',
       'v2_community_action_receipts'
     ])
 ) then
   raise exception 'Unknown directional Community table requires export review'
     using errcode='42501';
 end if;
 -- Directional social relations do not carry a user_id column. They MUST be
 -- reviewed as a complete group, never silently left out of owner export.
 -- Incoming *block* decisions are another actor's private information and
 -- must not be disclosed through an account export.
 if exists(select 1 from (values
   ('allin_private.v2_community_visibility'),
   ('allin_private.v2_community_pair_revisions'),
   ('allin_private.v2_community_follows'),
   ('allin_private.v2_community_blocks'),
   ('allin_private.v2_community_action_receipts')
 ) as expected(relation_name)
 where pg_catalog.to_regclass(expected.relation_name) is not null) then
   if exists(select 1 from (values
     ('allin_private.v2_community_visibility'),
     ('allin_private.v2_community_pair_revisions'),
     ('allin_private.v2_community_follows'),
     ('allin_private.v2_community_blocks'),
     ('allin_private.v2_community_action_receipts')
   ) as expected(relation_name)
   where pg_catalog.to_regclass(expected.relation_name) is null) then
     raise exception 'Partial community relationship export domain schema' using errcode='42501';
   end if;
   select jsonb_build_object(
     'visibility',(select to_jsonb(v) from allin_private.v2_community_visibility v
       where v.user_id=v_user),
     'outgoing_follows',coalesce((select jsonb_agg(to_jsonb(f) order by f.followed_id)
       from allin_private.v2_community_follows f where f.follower_id=v_user),'[]'::jsonb),
     'incoming_follow_requests',coalesce((select jsonb_agg(
       jsonb_build_object('follower_id',f.follower_id,'state',f.state,
         'requested_at',f.requested_at,'approved_at',f.approved_at)
       order by f.follower_id)
       from allin_private.v2_community_follows f where f.followed_id=v_user),'[]'::jsonb),
     'outgoing_blocks',coalesce((select jsonb_agg(to_jsonb(b) order by b.blocked_id)
       from allin_private.v2_community_blocks b where b.blocker_id=v_user),'[]'::jsonb),
     'my_action_receipts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.action_id)
       from allin_private.v2_community_action_receipts a where a.actor_id=v_user),'[]'::jsonb),
     'incoming_blocks_disclosed',false,
     'pair_revisions_disclosed',false,
     'relationship_export_policy','actor_owned_and_recipient_follow_requests_v1',
     'complete_community_export',false
   ) into v_community;
 end if;

 select jsonb_build_object(
   'schema_version','v2-account-export-snapshot-v2',
   'exported_at',now(),
   'account', (select jsonb_build_object('id',u.id,'email',u.email,
       'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at)
     from auth.users u where u.id=v_user),
   'profile',(select to_jsonb(p) from public.v2_profiles p where p.user_id=v_user),
   'profile_settings',(select to_jsonb(s) from public.v2_profile_settings s where s.user_id=v_user),
   'onboarding_progress',(select to_jsonb(o) from public.v2_onboarding_progress o where o.user_id=v_user),
   'legal_acceptances',coalesce((select jsonb_agg(to_jsonb(l) order by l.accepted_at)
     from public.v2_legal_acceptances l where l.user_id=v_user),'[]'::jsonb),
   'health_considerations',(select to_jsonb(h) from allin_private.v2_health_considerations h where h.user_id=v_user),
   'profile_settings_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
     from allin_private.v2_profile_settings_actions a where a.user_id=v_user),'[]'::jsonb),
   'onboarding_actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
     from allin_private.v2_onboarding_actions a where a.user_id=v_user),'[]'::jsonb),
   'deletion_request',(select to_jsonb(d) from allin_private.v2_account_deletion_requests d where d.user_id=v_user),
   'deletion_execution',(select to_jsonb(d) from allin_private.v2_account_deletion_execution_audit d where d.user_id=v_user),
   'goals',v_goals,
   'eventhub',v_eventhub,
   'community',v_community,
   'training_activity',allin_private.v2_training_account_export_fragment_candidate(v_user),
   -- Coach identity/contents/receipts remain part of the SAME owner export.
   -- Never include another user's messages, even if a thread UUID is known.
   'coach_conversation',pg_catalog.jsonb_build_object(
     'schema_version','v2-coach-account-fragment-candidate-v1',
     'threads',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.created_at,t.id)
       from public.v2_coach_threads t where t.user_id=v_user),'[]'::jsonb),
     'messages',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.created_at,m.id)
       from public.v2_coach_messages m where m.user_id=v_user),'[]'::jsonb),
     'message_actions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.created_at,a.client_action_id)
       from allin_private.v2_coach_message_actions a where a.user_id=v_user),'[]'::jsonb)
   )
 ) into v_export;
 if pg_catalog.octet_length(v_export::text) > 5000000 then
   raise exception 'Account snapshot exceeds inline limit; secure export required' using errcode='54000';
 end if;
 return v_export;
end;$function$;
revoke all on function public.v2_export_my_account_snapshot(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.v2_export_my_account_snapshot(uuid) to authenticated;
comment on function public.v2_export_my_account_snapshot(uuid) is
 'Owner-only V2 current-schema snapshot v2 candidate including Training, Activity and Coach conversation records; not live or file export. Fails closed for missing tables and Storage.';