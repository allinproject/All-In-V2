import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecoveryCoverage,recoveryDomains,findUntrackedRecoveryTables} from './all12-recovery-domain-manifest.mjs';
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
