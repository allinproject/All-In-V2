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
 v_goal_edition_links jsonb;
 v_eventhub jsonb;
 v_community jsonb;
 v_billing jsonb;
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
         'v2_goal_event_edition_links',
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
         'v2_coach_turn_claims',
         'v2_training_plan_accept_receipts','v2_account_export_requests_candidate'
       ]))
     )
 ) then
   raise exception 'New personal data tables require export coverage' using errcode='42501';
 end if;

 -- Future Nutrition, Progress, cookbook and equipment schemas are not
 -- covered merely because an author chose a different owner column name.
 -- Block new domain tables (including reference-like names) until each is
 -- classified as personal or reference and added to this owning registry.
 IF EXISTS (
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')
     AND (c.relname LIKE 'v2_nutrition_%'
       OR c.relname LIKE 'v2_progress_%'
       OR (c.relname LIKE 'v2_food_%'
          AND NOT ((n.nspname='public'
            AND c.relname='v2_food_log_entries')
          OR (n.nspname='allin_private'
            AND c.relname='v2_food_log_write_actions')))
       OR (c.relname LIKE 'v2_hydration_%'
          AND c.relname <> 'v2_hydration_events'
          AND c.relname <> 'v2_hydration_actions')
       -- Reviewed reference and internal-only relations are classified
       -- explicitly; any NEW table in the same domain still fails closed.
       OR (c.relname LIKE 'v2_ingredient_%' AND NOT (
          (n.nspname='public' AND c.relname=ANY(ARRAY[
            'v2_ingredient_aliases','v2_ingredient_measure_conversions',
            'v2_ingredient_nutrition_profiles','v2_ingredient_profile_nutrients',
            'v2_ingredient_profile_sources','v2_ingredient_source_records']))
          OR (n.nspname='allin_private' AND c.relname=ANY(ARRAY[
            'v2_ingredient_energy_attestations',
            'v2_ingredient_operator_credential_events',
            'v2_ingredient_review_events','v2_ingredient_review_operators',
            'v2_ingredient_source_energy_evidence']))))
       OR (c.relname LIKE 'v2_nutrient_%' AND NOT (
          n.nspname='public' AND c.relname='v2_nutrient_definitions'))
       OR (c.relname LIKE 'v2_coach_request_%' AND NOT (
          n.nspname='allin_private' AND c.relname='v2_coach_request_policy'))
       OR (c.relname LIKE 'v2_privileged_storage_%' AND NOT (
          n.nspname='allin_private'
          AND c.relname='v2_privileged_storage_write_leases_review'))
       OR c.relname LIKE 'v2_recipe_%'
       OR c.relname LIKE 'v2_cookbook_%'
       OR c.relname LIKE 'v2_gear_%'
       OR c.relname LIKE 'v2_shoe_%'
       OR c.relname LIKE 'v2_meal_%'
       OR c.relname LIKE 'v2_pantry_%'
       OR c.relname LIKE 'v2_macro_%'
       OR c.relname LIKE 'v2_body_%'
       OR c.relname LIKE 'v2_equipment_%'
       OR c.relname LIKE 'v2_race_%'
       OR c.relname LIKE 'v2_personal_record_%'
       OR c.relname LIKE 'v2_achievement_%')
 ) THEN RAISE EXCEPTION 'New domain requires explicit account export classification'
   USING ERRCODE='42501'; END IF;
 -- ALL-251 PRIVILEGED STORAGE: the durable write-lease ledger is operational
 -- security state, not downloadable athlete history. Classify this EXACT
 -- existing table explicitly, but only while the full safety contract holds.
 -- A newer or renamed owner_id relation still fails the unknown-key scanner.
 IF pg_catalog.to_regclass(
   'allin_private.v2_privileged_storage_write_leases_review') IS NOT NULL THEN
  IF NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid=pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
      AND c.relkind='r' AND c.relrowsecurity
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
      AND a.attname='owner_id' AND a.attnum>0 AND NOT a.attisdropped
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_attribute col
      ON col.attrelid=fk.conrelid AND col.attname='owner_id'
    WHERE fk.conrelid=pg_catalog.to_regclass('allin_private.v2_privileged_storage_write_leases_review')
      AND fk.confrelid='auth.users'::pg_catalog.regclass
      AND fk.contype='f' AND fk.confdeltype='c'
      AND col.attnum=ANY(fk.conkey)
  ) OR pg_catalog.has_table_privilege('anon',
    'allin_private.v2_privileged_storage_write_leases_review',
    'SELECT,INSERT,UPDATE,DELETE')
  OR pg_catalog.has_table_privilege('authenticated',
    'allin_private.v2_privileged_storage_write_leases_review',
    'SELECT,INSERT,UPDATE,DELETE')
  OR pg_catalog.has_table_privilege('service_role',
    'allin_private.v2_privileged_storage_write_leases_review',
    'SELECT,INSERT,UPDATE,DELETE')
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='allin_private.v2_account_deletion_requests'::pg_catalog.regclass
      AND t.tgname='v2_privileged_storage_write_fence_review'
      AND t.tgenabled='O' AND NOT t.tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='auth.users'::pg_catalog.regclass
      AND t.tgname='v2_privileged_storage_auth_delete_fence_review'
      AND t.tgenabled='O' AND NOT t.tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='storage.objects'::pg_catalog.regclass
      AND t.tgname='v2_privileged_storage_metadata_write_fence_review'
      AND t.tgenabled='O' AND NOT t.tgisinternal)
  THEN RAISE EXCEPTION 'Privileged Storage lease ledger or write/delete fences changed'
    USING ERRCODE='42501';
  END IF;
 END IF;
 -- Future owner data can use owner_id / athlete_id / actor_id rather
 -- than user_id.  Reject unknown V2 relations before a supposedly complete
 -- export silently skips Nutrition, Progress, equipment or Community posts.
 -- The four canonical directional relationship ledgers are reviewed below.
 IF EXISTS(
   SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname IN ('public','allin_private')
     AND c.relkind IN ('r','p') AND c.relname LIKE 'v2_%'
     AND a.attnum>0 AND NOT a.attisdropped
     AND a.attname IN ('owner_id','athlete_id','actor_id','created_by_user_id',
       'account_id','profile_id','athlete_user_id')
     AND NOT EXISTS(
       SELECT 1 FROM pg_catalog.pg_attribute owned
       WHERE owned.attrelid=c.oid AND owned.attname='user_id'
         AND owned.attnum>0 AND NOT owned.attisdropped
     )
     AND NOT (
       n.nspname='allin_private' AND c.relname=ANY(ARRAY[
         'v2_community_pair_revisions','v2_community_follows',
         'v2_community_blocks','v2_community_action_receipts',
         'v2_subscription_checkout_attempts','v2_subscription_purchases',
         'v2_privileged_storage_write_leases_review'
       ])
     )
 ) THEN RAISE EXCEPTION 'Unreviewed alternate-key owner table requires export coverage'
      USING ERRCODE='42501'; END IF;

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
   -- Preserve typed accepted Goal/Event edition bindings in the owning Goals
   -- export. The link table is a review candidate and may not exist in
   -- older foundation-only schema replays.
   if pg_catalog.to_regclass('public.v2_goal_event_edition_links') is not null then
     select coalesce(jsonb_agg(to_jsonb(l) order by l.goal_revision_id),'[]'::jsonb)
       into v_goal_edition_links
       from public.v2_goal_event_edition_links l where l.user_id=v_user;
   else
     v_goal_edition_links := '[]'::jsonb;
   end if;
   select jsonb_build_object(
     'event_edition_links',v_goal_edition_links,
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
       from allin_private.v2_community_follows f where f.followed_id=v_user
       and not exists (select 1 from allin_private.v2_community_blocks b
         where (b.blocker_id=f.follower_id and b.blocked_id=v_user)
           or (b.blocker_id=v_user and b.blocked_id=f.follower_id))),'[]'::jsonb),
     'outgoing_blocks',coalesce((select jsonb_agg(to_jsonb(b) order by b.blocked_id)
       from allin_private.v2_community_blocks b where b.blocker_id=v_user),'[]'::jsonb),
     'my_action_receipts',coalesce((select jsonb_agg(jsonb_build_object('action_id',a.action_id,'action',a.action,'target_id',a.target_id,'created_at',a.created_at) order by a.created_at,a.action_id)
       from allin_private.v2_community_action_receipts a where a.actor_id=v_user),'[]'::jsonb),
     'incoming_blocks_disclosed',false,
     'pair_revisions_disclosed',false,
     'relationship_export_policy','actor_owned_and_recipient_follow_requests_v1',
     'complete_community_export',false
   ) into v_community;
 end if;

 -- Billing is owned through owner_id, not user_id. Event receipts inherit
 -- ownership via purchase_id. Provider internal IDs must not leak into export.
 IF EXISTS(
   SELECT 1 FROM (VALUES
    ('allin_private.v2_subscription_checkout_attempts'),
    ('allin_private.v2_subscription_purchases'),
    ('allin_private.v2_subscription_verified_events')
   ) AS required(name) WHERE pg_catalog.to_regclass(required.name) IS NULL
 ) THEN RAISE EXCEPTION 'Billing export source graph is incomplete'
    USING ERRCODE='42501'; END IF;
 SELECT pg_catalog.jsonb_build_object(
   'checkout_attempts',coalesce((SELECT pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('attemptId',t.attempt_id,'provider',t.provider,
       'environment',t.environment,'offerKind',t.offer_kind,
       'state',t.state,'verifiedAt',t.verified_at) ORDER BY t.attempt_id)
       FROM allin_private.v2_subscription_checkout_attempts t
       WHERE t.owner_id=v_user),'[]'::jsonb),
   'purchases',coalesce((SELECT pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('purchaseId',t.id,'checkoutAttemptId',t.checkout_attempt_id,
       'provider',t.provider,'environment',t.environment,'phase',t.phase,
       'revision',t.revision,'accessUntil',t.access_until,'updatedAt',t.updated_at)
       ORDER BY t.id)
       FROM allin_private.v2_subscription_purchases t
       WHERE t.owner_id=v_user),'[]'::jsonb),
   'verified_events',coalesce((SELECT pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('purchaseId',e.purchase_id,'provider',e.provider,
       'environment',e.environment,'revision',e.revision,'acceptedAt',e.accepted_at)
       ORDER BY e.purchase_id,e.revision)
       FROM allin_private.v2_subscription_verified_events e
       JOIN allin_private.v2_subscription_purchases p ON p.id=e.purchase_id
       WHERE p.owner_id=v_user),'[]'::jsonb),
   'providerInternalIdentifiersDisclosed',false
 ) INTO v_billing;

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
   'billing',v_billing,
   'training_activity',allin_private.v2_training_account_export_fragment_candidate(v_user),
   -- Export the one persistent conversation and its messages.
   -- Private pre-provider claims contain execution/fencing internals, not
   -- portable conversation content; they remain server-only and cascade-delete.
   'coach_conversation',pg_catalog.jsonb_build_object(
     'schema_version','v2-coach-account-fragment-candidate-v2',
     'threads',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.created_at,t.id)
       from public.v2_coach_threads t where t.user_id=v_user),'[]'::jsonb),
     'messages',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.created_at,m.id)
       from public.v2_coach_messages m where m.user_id=v_user),'[]'::jsonb)
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