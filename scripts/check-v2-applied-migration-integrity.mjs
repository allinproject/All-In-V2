// ALL-222: immutable V2 foundation provenance from the authoritative
// Supabase schema_migrations statements (as observed 2026-11-11).
// Review-only: no Supabase connection, DDL or production action.
// Do not edit historical migrations in place; add a new higher-version file.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

export const appliedFoundation=Object.freeze([
  ['20261110021548_v2_auth_profile_legal_foundation.sql','443b6e0fa99f13a6e622163070e3a437794a7f0a7529192da3c243dcd232bdfd'],
  ['20261110022457_v2_tighten_profile_privileges_and_legal_versions.sql','4c5d8201931102686f1aafa69d153d2457e44e087b39839319138479034a3df5'],
  ['20261110032039_v2_provider_cache_and_private_rls.sql','d08425a37f14b5c2c37f039b68e727b2649b8b771de2d2ccd51937632cb1c45f'],
  ['20261110101200_v2_onboarding_progress_writer.sql','0d504a4a3be6b5cd2a8c2b9203f13e26367773df1491c1c23c81ac300e8f9833'],
  ['20261110105423_v2_expected_owner_mutation_guards.sql','1e75109b234b9746de8e2d46a5d2b3bbdd29aa019ac1954587513f3dca4cc00b'],
  ['20261110122952_v2_provider_cache_expired_cleanup.sql','37f2ebdf2c07e5e83f20e9cef44aeaf22e3dfd47e85a6d8474afd2c8c79db8d3'],
  ['20261110124420_v2_provider_cache_cron_schedule.sql','ce2e1264fded3b1f49de874134f32a22da06ba3845eeaf37208e01a381f23e2d'],
  ['20261111110324_v2_private_health_considerations_opt_in.sql','72d6aa677006f03498250810e8cfd5dbd21378d22d1f5699a2242c2c0cfc846a'],
  ['20261111120805_v2_owner_verified_account_deletion_request_intake.sql','eb8cd6da7a28a57c86b10055ebd5daf351807f5d0c67be723fdee0d9f35e0d4c'],
  ['20261111121605_v2_owner_bound_deletion_request_cancel_before_processing.sql','ac12fefec9215b508fdfd5f93bbc0c7f4714cd36421556b5bf46efdf512dfb1d'],
  ['20261111123133_v2_service_only_deletion_processing_claim.sql','f9b37e5a746bfdca09df6357f872b21ffde12e8d3f3312bc88bcc8a1ca44e986'],
  ['20261111123642_v2_account_deletion_processor_default_off_gate.sql','874e200024e378f86a41673f029f58a24d43dccda5fd0ae534e0f7fae7794a7d'],
  ['20261111123939_v2_deletion_claim_fail_closed_storage_and_owner_coverage.sql','534a3135cf5f651c2ba46cbf3641a63ca8aaa79fa90e3b75615794bf8c5798ee'],
  ['20261111124645_v2_deletion_durable_minimal_execution_audit_and_receipts.sql','02ea07fed6c5c425a2de0dafe49a39f3f1af54d002f1e4269b395615aea03f0e'],
  ['20261111130824_v2_deletion_completion_verify_auth_sessions_and_owner_rows.sql','8e0480426069fec7c3990ed59f25f6f1d434c63c495d52926fcfd9f82425ed4f'],
  ['20261111131212_v2_stale_auth_token_account_existence_guards.sql','2f18e544051a9542e346a958b7c90248504596db4c577eeb9512bf6ed15e9ad8'],
  ['20261111133540_v2_deletion_completion_readback_after_ambiguous_receipt.sql','cf333984f38cc009328cf5e2a4bfedc792085a55510e62995b5be19837e383cc'],
  ['20261111134456_v2_owner_bound_current_data_export_snapshot.sql','44326eeb7385c096464c684c7dbd7c16f7ad028189f736629d0c47b446288ebf']
]);

export function auditAppliedMigrations(fileNames,readSql,baseline=appliedFoundation){
 const problems=[];
 const names=new Set(fileNames);
 const last=baseline.at(-1)?.[0].slice(0,14);
 if(!last||baseline.some(([name])=>!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)))
   return {ok:false,problems:['Invalid foundation manifest']};
 for(const [name,digest] of baseline){
   if(!names.has(name)){problems.push('Missing applied migration: '+name);continue;}
   try{
     const actual=createHash('sha256').update(readSql(name),'utf8').digest('hex');
     if(actual!==digest)problems.push('Deployed migration contents changed: '+name);
   }catch{problems.push('Cannot read applied migration: '+name);}
 }
 const expected=new Set(baseline.map(([name])=>name));
 for(const name of fileNames){
   if(!/^\d{14}_[a-z0-9_]+\.sql$/.test(name))continue;
   if(name.slice(0,14)<=last&&!expected.has(name))
     problems.push('Unrecorded historical migration filename: '+name);
 }
 return {ok:problems.length===0,problems,appliedCount:baseline.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const folder=resolve(dirname(fileURLToPath(import.meta.url)),'../supabase/migrations');
 const result=auditAppliedMigrations(readdirSync(folder),
   name=>readFileSync(resolve(folder,name),'utf8'));
 if(!result.ok){
   for(const issue of result.problems)console.error('ERROR: '+issue);
   process.exitCode=1;
 }else{
   console.log('PASS ALL-222: '+result.appliedCount+
     ' applied foundation migrations match Supabase source SHA-256; no historical drift.');
 }
}
