// ALL-12: recovery scope is explicit; missing domains never silently count as backed up.
// No database access or secrets. Used to gate future full logical dump/restore tests.
export const recoveryDomains=Object.freeze([
 {name:'auth',tables:['auth.users','auth.identities','auth.sessions','auth.refresh_tokens'],kind:'database'},
 {name:'profile_legal',tables:['public.v2_profiles','public.v2_profile_settings','public.v2_onboarding_progress','public.v2_legal_documents','public.v2_legal_acceptances','allin_private.v2_profile_settings_actions','allin_private.v2_onboarding_actions'],kind:'database'},
 {name:'training',tables:['public.v2_training_session_instances','allin_private.v2_training_action_receipts','allin_private.v2_training_completion_outbox','allin_private.v2_training_plan_accept_receipts','public.v2_training_execution_events','public.v2_training_plan_revisions','public.v2_training_plans','public.v2_training_revision_days','public.v2_training_revision_sessions','public.v2_training_session_slots'],kind:'database'},
 {name:'completed_activity',tables:['public.v2_completed_activities','public.v2_activity_sources','public.v2_activity_metric_definitions','public.v2_activity_metric_values','public.v2_activity_route_objects','public.v2_activity_segments','public.v2_activity_series','public.v2_activity_strength_sets'],kind:'database'},
 {name:'coach',tables:['public.v2_coach_threads','public.v2_coach_messages','allin_private.v2_coach_turn_claims','allin_private.v2_coach_request_policy'],kind:'database'},
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

/**
 * Physical provider-restore acceptance is deliberately separate from local
 * logical coverage. The caller must supply evidence from an actual, independently
 * restored project; a completed CI run or same-project roundtrip is insufficient.
 *
 * No credentials, dumps, actual user data or snapshot contents belong here.
 * Caller-provided evidence identifiers/timestamps are only release-review inputs,
 * not independently verified provider attestations.
 */
export function assessIndependentRecoveryEvidence(evidence={}) {
 const required=[
  ['sourceProjectRef', v=>typeof v==='string'&&v.length>0],
  ['backupSnapshotId', v=>typeof v==='string'&&v.length>0],
  ['backupCutoffUtc', v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))],
  ['restoredProjectRef', v=>typeof v==='string'&&v.length>0],
  ['restoreStartedUtc', v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))],
  ['restoreCompletedUtc', v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))],
  ['measuredRpoSeconds', v=>Number.isFinite(v)&&v>=0],
  ['measuredRtoSeconds', v=>Number.isFinite(v)&&v>=0],
  ['providerPhysicalRestore', v=>v===true],
  ['preStartOutboundIsolationVerified', v=>v===true],
  ['scheduledWorkersQuarantinedBeforeStartup', v=>v===true],
  ['sourceTargetSnapshotCompared', v=>v===true],
  ['restoredSchemaAndRlsVerified', v=>v===true],
  ['restoredOwnerAuthBoundaryVerified', v=>v===true],
  ['restoredDataIntegrityVerified', v=>v===true],
  ['authConfigurationRecovered', v=>v===true],
  ['privateStorageBytesAndMetadataRecovered', v=>v===true],
  ['liveSchemaDomainInventoryReconciled', v=>v===true],
  ['reviewedReleaseAuthorization', v=>v===true],
 ];
 const missing=required.filter(([field,valid])=>!valid(evidence[field])).map(([field])=>field);
 const source=evidence.sourceProjectRef,restored=evidence.restoredProjectRef;
 if(source && restored && source===restored) missing.push('independentDestination');
 const t0=Date.parse(evidence.restoreStartedUtc);
 const t1=Date.parse(evidence.restoreCompletedUtc);
 const cutoff=Date.parse(evidence.backupCutoffUtc);
 if(Number.isFinite(t0)&&Number.isFinite(t1)&&t1<t0) missing.push('validRestoreTimeOrder');
 if(Number.isFinite(cutoff)&&Number.isFinite(t1)&&cutoff>t1) missing.push('validSnapshotCutoff');
 return {accepted:missing.length===0,missing};
}

/**
 * Independent LOGICAL recovery acceptance, separate from provider physical
 * backup acceptance. This is an evidence-shape gate, not an attestation:
 * reviewers must independently verify every artifact and test result.
 * Source data and secrets must never be included in this object.
 */
export function assessIndependentLogicalRecoveryEvidence(evidence={}) {
 const isText=v=>typeof v==='string'&&v.trim().length>0;
 const isUtc=v=>isText(v)&&/^\\d{4}-\\d\\d-\\d\\dT.*(?:Z|\\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v));
 const nonNegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const checks=[
  ['recoveryMethod',v=>v==='independent_logical'],
  ['sourceProjectRef',isText],
  ['backupArtifactDigest',v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v)],
  ['backupCutoffUtc',isUtc],
  ['backupStartedUtc',isUtc],
  ['backupCompletedUtc',isUtc],
  ['restoreStartedUtc',isUtc],
  ['restoreVerifiedUtc',isUtc],
  ['isolatedTargetId',isText],
  ['preImportOutboundIsolationVerified',v=>v===true],
  ['unsafeSqlAndScheduledJobsExcluded',v=>v===true],
  ['sourceAtCutoffManifestVerified',v=>v===true],
  ['deployedDomainsReconciled',v=>v===true],
  ['authDatabaseAndSignInRecovered',v=>v===true],
  ['authProviderConfigurationRecreated',v=>v===true],
  ['privateStorageInventoryAndBytesRecovered',v=>v===true],
  ['rlsAndCrossOwnerDenialsPassed',v=>v===true],
  ['allPresentOwnerDataDigestsMatch',v=>v===true],
  ['measuredRpoSeconds',nonNegative],
  ['measuredRtoSeconds',nonNegative],
  ['backupArtifactDestroyedOrSecured',v=>v===true],
  ['evidenceReviewed',v=>v===true],
  ['founderAcceptedLogicalRecoveryScope',v=>v===true]
 ];
 const missing=checks.filter(([k,valid])=>!valid(evidence[k])).map(([k])=>k);
 if(isText(evidence.sourceProjectRef)&&evidence.sourceProjectRef===evidence.isolatedTargetId)
  missing.push('independentTarget');
 const cutoff=Date.parse(evidence.backupCutoffUtc);
 const start=Date.parse(evidence.backupStartedUtc);
 const backed=Date.parse(evidence.backupCompletedUtc);
 const restore=Date.parse(evidence.restoreStartedUtc);
 const verified=Date.parse(evidence.restoreVerifiedUtc);
 if([cutoff,start,backed,restore,verified].every(Number.isFinite)&&
    !(start<=cutoff&&cutoff<=backed&&backed<=restore&&restore<=verified))
  missing.push('consistentBackupAndRecoveryTimeline');
 return {accepted:missing.length===0,missing};
}
