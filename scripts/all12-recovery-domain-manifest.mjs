// ALL-12: recovery scope is explicit; missing domains never silently count as backed up.
// No database access or secrets. Used to gate future full logical dump/restore tests.
export const recoveryDomains=Object.freeze([
 {name:'auth',tables:['auth.users','auth.identities','auth.sessions','auth.refresh_tokens'],kind:'database'},
 {name:'profile_legal',tables:['public.v2_profiles','public.v2_profile_settings','public.v2_onboarding_progress','public.v2_legal_documents','public.v2_legal_acceptances','allin_private.v2_profile_settings_actions','allin_private.v2_onboarding_actions'],kind:'database'},
 {name:'training',tables:['public.v2_training_session_instances','allin_private.v2_training_action_receipts','allin_private.v2_training_completion_outbox','allin_private.v2_training_plan_accept_receipts','public.v2_training_execution_events','public.v2_training_plan_revisions','public.v2_training_plans','public.v2_training_revision_days','public.v2_training_revision_sessions','public.v2_training_session_slots'],kind:'database'},
 {name:'completed_activity',tables:['public.v2_completed_activities','public.v2_activity_sources','public.v2_activity_metric_definitions','public.v2_activity_metric_values','public.v2_activity_route_objects','public.v2_activity_segments','public.v2_activity_series','public.v2_activity_strength_sets'],kind:'database'},
 {name:'coach',tables:['public.v2_coach_threads','public.v2_coach_messages','allin_private.v2_coach_message_actions'],kind:'database'},
 {name:'goals',tables:['public.v2_goals','public.v2_goal_revisions','allin_private.v2_goal_acceptance_actions','allin_private.v2_goal_approval_reviews','public.v2_goal_revision_behavior_targets'],kind:'database'},
 {name:'billing',tables:['allin_private.v2_subscription_purchases','allin_private.v2_subscription_verified_events','allin_private.v2_subscription_checkout_attempts'],kind:'database'},
 {name:'health_privacy',tables:['allin_private.v2_health_considerations','allin_private.v2_account_deletion_requests','allin_private.v2_account_deletion_processor_config','allin_private.v2_account_deletion_execution_audit','allin_private.v2_account_export_requests_candidate'],kind:'database'},
 {name:'provider_cache',tables:['allin_private.v2_provider_cache'],kind:'database'},
 {name:'community',tables:['allin_private.v2_community_action_receipts','allin_private.v2_community_blocks','allin_private.v2_community_follows','allin_private.v2_community_pair_revisions','allin_private.v2_community_visibility'],kind:'pending_schema'},
 {name:'nutrition',tables:[],kind:'pending_schema'},
 {name:'progress_recovery',tables:['allin_private.v2_indoor_weekly_config','public.v2_indoor_weekly_achievements','public.v2_indoor_weekly_attempts','public.v2_indoor_weekly_challenges','public.v2_indoor_weekly_leaderboard'],kind:'pending_schema'},
 {name:'eventhub',tables:['allin_private.v2_event_group_actions','public.v2_event_group_memberships','public.v2_event_groups','public.v2_event_participations','public.v2_event_url_aliases','public.v2_events'],kind:'pending_schema'},
 {name:'private_media',tables:[],kind:'storage'},
 {name:'auth_configuration',tables:[],kind:'configuration'}
]);
export function findUntrackedRecoveryTables(actualTables=[]) {
 const declared=new Set(recoveryDomains.flatMap(domain=>domain.tables));
 return [...new Set(actualTables)].filter(table=>
  /^(?:public|allin_private)\.v2_[a-z0-9_]+$/.test(table) && !declared.has(table)
 ).sort();
}
export function assessRecoveryCoverage({presentTables=[],verifiedTables=[],verifiedExternal=[],actualTables=[]}={}){
 const present=new Set(presentTables),verified=new Set(verifiedTables),external=new Set(verifiedExternal);
 const result=recoveryDomains.map(domain=>{
  const absent=domain.tables.filter(t=>!present.has(t));
  const unverified=domain.tables.filter(t=>present.has(t)&&!verified.has(t));
  const status=domain.kind==='pending_schema'?'unverified':domain.kind!=='database'?(external.has(domain.name)?'verified':'unverified'):
    absent.length?'absent':unverified.length?'unverified':'verified';
  return {name:domain.name,status,absent,unverified};
 });
 const untrackedTables=findUntrackedRecoveryTables(actualTables);
 return {complete:untrackedTables.length===0 && result.every(d=>d.status==='verified'),domains:result,untrackedTables};
}
