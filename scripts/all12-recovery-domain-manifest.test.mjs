import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecoveryCoverage,recoveryDomains,findUntrackedRecoveryTables,assessIndependentRecoveryEvidence} from './all12-recovery-domain-manifest.mjs';
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
