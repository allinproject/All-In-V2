import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecoveryCoverage,recoveryDomains,findUntrackedRecoveryTables,assessIndependentRecoveryEvidence,assessIndependentLogicalRecoveryEvidence} from './all12-recovery-domain-manifest.mjs';
test('missing domains fail closed',()=>{
 const x=assessRecoveryCoverage();
 assert.equal(x.complete,false);
 assert.equal(x.domains.find(d=>d.name==='coach').status,'absent');
});
test('database-only restore cannot claim media or Auth config',()=>{
 const tables=recoveryDomains.flatMap(d=>d.tables);
 const x=assessRecoveryCoverage({presentTables:tables,verifiedTables:tables});
 assert.equal(x.complete,false);
 assert.equal(x.domains.find(d=>d.name==='private_media').status,'unverified');
 assert.equal(x.domains.find(d=>d.name==='auth_configuration').status,'unverified');
});
test('partial Training or Completed Activity coverage fails closed',()=>{
 const tables=recoveryDomains.flatMap(d=>d.tables);
 const x=assessRecoveryCoverage({presentTables:tables,verifiedTables:tables.filter(t=>t!=='public.v2_activity_sources'),verifiedExternal:['private_media','auth_configuration']});
 assert.equal(x.complete,false);
 assert.deepEqual(x.domains.find(d=>d.name==='completed_activity').unverified,['public.v2_activity_sources']);
});
test('pending schema domains cannot be claimed complete by table-only evidence',()=>{
 const tables=recoveryDomains.flatMap(d=>d.tables);
 const coverage=assessRecoveryCoverage({presentTables:tables,verifiedTables:tables,verifiedExternal:['private_media','auth_configuration']});
 assert.equal(coverage.complete,false);
 assert.equal(coverage.domains.find(d=>d.name==='nutrition').status,'unverified');
 assert.equal(coverage.domains.find(d=>d.name==='community').status,'unverified');
});

test('new V2 data tables cannot silently escape recovery inventory',()=>{
 assert.deepEqual(findUntrackedRecoveryTables([
  'public.v2_coach_messages',
  'public.v2_new_nutrition_records',
  'allin_private.v2_new_export_jobs',
  'storage.objects',
  'public.legacy_table',
  'public.v2_new_nutrition_records'
 ]),['allin_private.v2_new_export_jobs','public.v2_new_nutrition_records']);
 const all=recoveryDomains.flatMap(d=>d.tables);
 const result=assessRecoveryCoverage({presentTables:all,verifiedTables:all,
  verifiedExternal:['private_media','auth_configuration'],
  actualTables:['public.v2_new_nutrition_records']});
 assert.equal(result.complete,false);
 assert.deepEqual(result.untrackedTables,['public.v2_new_nutrition_records']);
});

test('hosted V2 foundation inventory is fully classified',()=>{
 const hosted=[
  'public.v2_profiles','public.v2_profile_settings','public.v2_onboarding_progress',
  'public.v2_legal_documents','public.v2_legal_acceptances',
  'allin_private.v2_profile_settings_actions','allin_private.v2_provider_cache',
  'allin_private.v2_onboarding_actions','allin_private.v2_health_considerations',
  'allin_private.v2_account_deletion_requests',
  'allin_private.v2_account_deletion_processor_config',
  'allin_private.v2_account_deletion_execution_audit'
 ];
 assert.deepEqual(findUntrackedRecoveryTables(hosted),[]);
});


test('local logical restore evidence never constitutes provider physical restore acceptance',()=>{
 const r=assessIndependentRecoveryEvidence({
  sourceProjectRef:'v2-source',restoredProjectRef:'v2-source',
  localLogicalRestorePassed:true,storageSyntheticPassed:true,authSyntheticPassed:true
 });
 assert.equal(r.accepted,false);
 assert.ok(r.missing.includes('providerPhysicalRestore'));
 assert.ok(r.missing.includes('independentDestination'));
 assert.ok(r.missing.includes('preStartOutboundIsolationVerified'));
 assert.ok(r.missing.includes('reviewedReleaseAuthorization'));
});

test('a provider completion claim without operational recovery evidence fails closed',()=>{
 const r=assessIndependentRecoveryEvidence({
  sourceProjectRef:'source',restoredProjectRef:'independent-target',
  backupSnapshotId:'provider-snapshot',backupCutoffUtc:'2026-11-10T00:00:00Z',
  restoreStartedUtc:'2026-11-10T01:00:00Z',
  restoreCompletedUtc:'2026-11-10T01:10:00Z',
  measuredRpoSeconds:3600,measuredRtoSeconds:600,providerPhysicalRestore:true
 });
 assert.equal(r.accepted,false);
 for(const field of ['preStartOutboundIsolationVerified','restoredOwnerAuthBoundaryVerified',
   'authConfigurationRecovered','privateStorageBytesAndMetadataRecovered',
   'liveSchemaDomainInventoryReconciled','reviewedReleaseAuthorization']){
  assert.ok(r.missing.includes(field),field);
 }
});

test('invalid timing and same project cannot be accepted',()=>{
 const r=assessIndependentRecoveryEvidence({
  sourceProjectRef:'a',restoredProjectRef:'a',
  backupCutoffUtc:'2026-11-12T02:00:00Z',
  restoreStartedUtc:'2026-11-12T03:00:00Z',
  restoreCompletedUtc:'2026-11-12T01:00:00Z',
  measuredRpoSeconds:-1,measuredRtoSeconds:-1
 });
 assert.equal(r.accepted,false);
 assert.ok(r.missing.includes('validRestoreTimeOrder'));
 assert.ok(r.missing.includes('validSnapshotCutoff'));
 assert.ok(r.missing.includes('independentDestination'));
});

test('complete independently reviewed physical recovery evidence can satisfy its own gate',()=>{
 const r=assessIndependentRecoveryEvidence({
  sourceProjectRef:'source',restoredProjectRef:'isolated-target',
  backupSnapshotId:'provider-snapshot-123',
  backupCutoffUtc:'2026-11-10T00:00:00Z',
  restoreStartedUtc:'2026-11-10T01:00:00Z',
  restoreCompletedUtc:'2026-11-10T01:10:00Z',
  measuredRpoSeconds:3600,measuredRtoSeconds:600,
  providerPhysicalRestore:true,preStartOutboundIsolationVerified:true,
  scheduledWorkersQuarantinedBeforeStartup:true,
  sourceTargetSnapshotCompared:true,restoredSchemaAndRlsVerified:true,
  restoredOwnerAuthBoundaryVerified:true,restoredDataIntegrityVerified:true,
  authConfigurationRecovered:true,privateStorageBytesAndMetadataRecovered:true,
  liveSchemaDomainInventoryReconciled:true,reviewedReleaseAuthorization:true
 });
 assert.deepEqual(r,{accepted:true,missing:[]});
});

test('canonical Coach recovery inventory follows actual SQL candidate',()=>{
 const coach=recoveryDomains.find(d=>d.name==='coach');
 assert.deepEqual(coach.tables,[
  'public.v2_coach_threads','public.v2_coach_messages',
  'allin_private.v2_coach_turn_claims',
  'allin_private.v2_coach_request_policy'
 ]);
 // Coach claims and policy are private operational state, not portable
 // account export rows; still mandatory in recovery logical backup.
 assert.deepEqual(findUntrackedRecoveryTables(coach.tables),[]);
});


test('green synthetic replay and physical-less logical plan are not accepted without real evidence',()=>{
 const r=assessIndependentLogicalRecoveryEvidence({
  recoveryMethod:'independent_logical',
  localSyntheticCiPassed:true,sourceProjectRef:'v2',
  physicalRestoreSkipped:true
 });
 assert.equal(r.accepted,false);
 for(const k of ['backupArtifactDigest','isolatedTargetId','measuredRpoSeconds',
  'privateStorageInventoryAndBytesRecovered','founderAcceptedLogicalRecoveryScope'])
  assert.ok(r.missing.includes(k),k);
 assert.ok(!r.missing.includes('providerPhysicalRestore'));
});
test('unsafe or self-targeted logical recoveries remain blocked',()=>{
 const r=assessIndependentLogicalRecoveryEvidence({
  recoveryMethod:'independent_logical',sourceProjectRef:'same',isolatedTargetId:'same',
  backupCutoffUtc:'2026-11-12T04:00:00Z',
  backupStartedUtc:'2026-11-12T05:00:00Z',
  backupCompletedUtc:'2026-11-12T05:05:00Z',
  restoreStartedUtc:'2026-11-12T05:06:00Z',
  restoreVerifiedUtc:'2026-11-12T05:10:00Z',
  preImportOutboundIsolationVerified:false
 });
 assert.equal(r.accepted,false);
 assert.ok(r.missing.includes('independentTarget'));
 assert.ok(r.missing.includes('consistentBackupAndRecoveryTimeline'));
 assert.ok(r.missing.includes('preImportOutboundIsolationVerified'));
});
test('complete independently reviewed logical evidence can satisfy its own gate without a physical clone',()=>{
 const r=assessIndependentLogicalRecoveryEvidence({
  recoveryMethod:'independent_logical',sourceProjectRef:'source',isolatedTargetId:'disposable-local',
  backupArtifactDigest:'a'.repeat(64),
  backupStartedUtc:'2026-11-12T04:00:00Z',backupCutoffUtc:'2026-11-12T04:01:00Z',
  backupCompletedUtc:'2026-11-12T04:05:00Z',
  restoreStartedUtc:'2026-11-12T04:06:00Z',
  restoreVerifiedUtc:'2026-11-12T04:10:00Z',
  preImportOutboundIsolationVerified:true,
  unsafeSqlAndScheduledJobsExcluded:true,sourceAtCutoffManifestVerified:true,
  deployedDomainsReconciled:true,
  authSourceUserCount:2,authSourceInventoryVerified:true,
  authDatabaseAndSignInRecovered:true,authProviderConfigurationRecreated:true,
  storageSourceObjectCount:2,storageSourceInventoryVerified:true,
  privateStorageInventoryAndBytesRecovered:true,rlsAndCrossOwnerDenialsPassed:true,
  allPresentOwnerDataDigestsMatch:true,measuredRpoSeconds:60,measuredRtoSeconds:240,
  backupArtifactDestroyedOrSecured:true,evidenceReviewed:true,
  founderAcceptedLogicalRecoveryScope:true
 });
 assert.deepEqual(r,{accepted:true,missing:[]});
});


test('empty V2 account and Storage inventories need verified empty recovery, never fabricated users or files',()=>{
 const base={
  recoveryMethod:'independent_logical',sourceProjectRef:'source',isolatedTargetId:'isolated',
  backupArtifactDigest:'b'.repeat(64),
  backupStartedUtc:'2026-11-12T04:00:00Z',
  backupCutoffUtc:'2026-11-12T04:01:00Z',
  backupCompletedUtc:'2026-11-12T04:02:00Z',
  restoreStartedUtc:'2026-11-12T04:03:00Z',
  restoreVerifiedUtc:'2026-11-12T04:10:00Z',
  preImportOutboundIsolationVerified:true,unsafeSqlAndScheduledJobsExcluded:true,
  sourceAtCutoffManifestVerified:true,deployedDomainsReconciled:true,
  authSourceUserCount:0,authSourceInventoryVerified:true,
  emptyAuthTargetVerified:true,authServiceBootVerified:true,
  authProviderConfigurationRecreated:true,
  storageSourceObjectCount:0,storageSourceInventoryVerified:true,
  emptyStorageTargetVerified:true,storageAccessPolicyVerified:true,
  rlsAndCrossOwnerDenialsPassed:true,allPresentOwnerDataDigestsMatch:true,
  measuredRpoSeconds:1,measuredRtoSeconds:420,
  backupArtifactDestroyedOrSecured:true,evidenceReviewed:true,
  founderAcceptedLogicalRecoveryScope:true
 };
 assert.deepEqual(assessIndependentLogicalRecoveryEvidence(base),{accepted:true,missing:[]});
 const noProof={...base,emptyAuthTargetVerified:false,emptyStorageTargetVerified:false};
 const denied=assessIndependentLogicalRecoveryEvidence(noProof);
 assert.equal(denied.accepted,false);
 assert.ok(denied.missing.includes('authDatabaseAndSignInRecovered'));
 assert.ok(denied.missing.includes('privateStorageInventoryAndBytesRecovered'));
});
test('populated source cannot pass with empty-data fallback',()=>{
 const populated={
  recoveryMethod:'independent_logical',sourceProjectRef:'source',isolatedTargetId:'isolated',
  authSourceUserCount:2,authSourceInventoryVerified:true,
  emptyAuthTargetVerified:true,authServiceBootVerified:true,
  storageSourceObjectCount:4,storageSourceInventoryVerified:true,
  emptyStorageTargetVerified:true,storageAccessPolicyVerified:true
 };
 const r=assessIndependentLogicalRecoveryEvidence(populated);
 assert.equal(r.accepted,false);
 assert.ok(r.missing.includes('authDatabaseAndSignInRecovered'));
 assert.ok(r.missing.includes('privateStorageInventoryAndBytesRecovered'));
});

test('Training restriction source, certification and action receipts remain explicit pending recovery gates',()=>{
 const domain=recoveryDomains.find(d=>d.name==='training_restrictions');
 assert.equal(domain?.kind,'pending_schema');
 assert.deepEqual(domain.tables,[
  'public.v2_training_athlete_restrictions',
  'allin_private.v2_training_restriction_certifications',
  'allin_private.v2_training_restriction_action_receipts',
  'allin_private.v2_training_restriction_source_evidence'
 ]);
 assert.deepEqual(findUntrackedRecoveryTables(domain.tables),[]);
 const tables=recoveryDomains.flatMap(d=>d.tables);
 const coverage=assessRecoveryCoverage({presentTables:tables,verifiedTables:tables,
  verifiedExternal:['private_media','auth_configuration']});
 assert.equal(coverage.complete,false);
 assert.equal(coverage.domains.find(d=>d.name==='training_restrictions').status,'unverified');
 const absent=assessRecoveryCoverage({presentTables:tables.filter(t=>t!=='allin_private.v2_training_restriction_certifications'),
  verifiedTables:tables,verifiedExternal:['private_media','auth_configuration']});
 assert.equal(absent.complete,false);
 assert.ok(absent.domains.find(d=>d.name==='training_restrictions').absent.includes('allin_private.v2_training_restriction_certifications'));
});
