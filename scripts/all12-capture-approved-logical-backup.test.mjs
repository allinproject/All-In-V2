import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCaptureInputs,assessCurrentV2TableCoverage} from './all12-capture-approved-logical-backup.mjs';

const env={
 ALL12_CAPTURE_APPROVED:'YES',
 ALL12_SOURCE_PROJECT_REF:'xarhuczrtzuiljmtdaeu',
 ALL12_SECURE_BACKUP_DIRECTORY_CONFIRMED:'YES',
 ALL12_BACKUP_DIRECTORY:'/tmp/approved-encrypted-volume',
 PGHOST:'db.xarhuczrtzuiljmtdaeu.supabase.co',PGUSER:'approved_readonly',PGDATABASE:'postgres',
 PGPASSWORD:'dummy-test-only',PGSSLMODE:'verify-full'
};
const approved={
 sourceProjectRef:'xarhuczrtzuiljmtdaeu',
 approvedForLogicalBackup:true,
 tables:['auth.users','allin_private.v2_account_deletion_requests','public.v2_profiles']
};
test('guarded local capture accepts only explicitly approved isolated operator configuration',()=>{
 assert.deepEqual(validateCaptureInputs({env,approved}),{valid:true,errors:[]});
});
test('CI and Github jobs cannot export production data',()=>{
 const c=validateCaptureInputs({env:{...env,CI:'true',GITHUB_ACTIONS:'true'},approved});
 assert.equal(c.valid,false);assert(c.errors.includes('local_operator_only'));
});
test('refuses missing permission and claimed secure backup location',()=>{
 const c=validateCaptureInputs({env:{...env,ALL12_CAPTURE_APPROVED:'NO',ALL12_SECURE_BACKUP_DIRECTORY_CONFIRMED:'NO'},approved});
 assert(c.errors.includes('explicit_capture_authorization_required'));
 assert(c.errors.includes('secure_offline_storage_confirmation_required'));
});
test('rejects unrelated project, weak TLS and missing credential',()=>{
 const c=validateCaptureInputs({env:{...env,ALL12_SOURCE_PROJECT_REF:'fbtgknlxjyeqrxemskbl',PGSSLMODE:'require',PGPASSWORD:''},approved});
 assert(c.errors.includes('v2_source_ref_required'));
 assert(c.errors.includes('tls_verify_full_required'));
 assert(c.errors.includes('missing_pgpassword'));
});
test('requires independent approved exact table list; blocks cron/vault and duplicates',()=>{
 for(const tables of [[],['cron.job'],['vault.secrets'],
  ['auth.users','auth.users'],['public.v2_profiles','public.bad;DROP TABLE']]){
  const x=validateCaptureInputs({env,approved:{...approved,tables}});
  assert(x.errors.includes('invalid_or_unsafe_table_inventory'));
 }
 const missing=validateCaptureInputs({env,approved:{...approved,approvedForLogicalBackup:false}});
 assert(missing.errors.includes('table_inventory_not_approved'));
});

test('source host identity must belong to expected V2 project, never a lookalike',()=>{
 const wrong=validateCaptureInputs({env:{...env,PGHOST:'db.impulecgsgaruvniuttc.supabase.co'},approved});
 assert(wrong.errors.includes('unrecognized_project_bound_endpoint'));
 const pooler=validateCaptureInputs({env:{
  ...env,PGHOST:'aws-0-us-east-1.pooler.supabase.com',PGUSER:'postgres.xarhuczrtzuiljmtdaeu'
 },approved});
 assert.equal(pooler.valid,true);
 const unscoped=validateCaptureInputs({env:{
  ...env,PGHOST:'aws-0-us-east-1.pooler.supabase.com',PGUSER:'postgres'
 },approved});
 assert(unscoped.errors.includes('unrecognized_project_bound_endpoint'));
});

test('live V2 preflight blocks newly deployed or omitted tables before backup',()=>{
 const approvedTables=[...approved.tables,'public.v2_profile_settings'];
 assert.deepEqual(assessCurrentV2TableCoverage({
   actualTables:['public.v2_profiles','public.v2_profile_settings'],
   approvedTables
 }),{valid:true,reasons:[]});
 const unexpected=assessCurrentV2TableCoverage({
   actualTables:['public.v2_profiles','allin_private.v2_new_private_domain'],
   approvedTables
 });
 assert.equal(unexpected.valid,false);
 assert(unexpected.reasons.includes('unapproved_live_v2_table:allin_private.v2_new_private_domain'));
});
test('live V2 preflight requires core Auth tables and rejects malformed catalog results',()=>{
 const a=assessCurrentV2TableCoverage({
   actualTables:['public.v2_profiles'],approvedTables:approved.tables
 });
 assert.equal(a.valid,false);
 assert(a.reasons.includes('missing_core_auth_table:auth.identities'));
 const malformed=assessCurrentV2TableCoverage({
   actualTables:['public.v2_profiles','public.v2_profiles'],
   approvedTables:[...approved.tables,'auth.identities','auth.sessions','auth.refresh_tokens']
 });
 assert(malformed.reasons.includes('invalid_live_v2_inventory'));
});
