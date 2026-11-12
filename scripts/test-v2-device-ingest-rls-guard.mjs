import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../docs/architecture/sql/V2-COMPLETED-ACTIVITY-PRIVATE-INGEST-GATEWAY-CANDIDATE.sql',import.meta.url),'utf8');
test('private gateway remains review-only and never grants client execution',()=>{
 assert.match(sql,/REVIEW ONLY\. NOT A VERSIONED MIGRATION/);
 assert.match(sql,/NOLOGIN NOINHERIT NOBYPASSRLS/);
 assert.match(sql,/rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb/);
 assert.match(sql,/rolcreaterole OR rolreplication OR rolbypassrls/);
 assert.match(sql,/Device ingest principal must have no role memberships/);
 assert.doesNotMatch(sql,/GRANT\s+allin_v2_device_ingest\s+TO\s+(?:anon|authenticated|service_role)/i);
 assert.match(sql,/REVOKE ALL ON FUNCTION allin_private\.v2_device_ingest_scalar_gateway_candidate\([\s\S]*?FROM PUBLIC,anon,authenticated,service_role;/);
});
test('each owner-bearing relation has an explicit scoped policy',()=>{
 for(const name of ['nonce_owner','activity_owner','source_owner','metric_read_owner','metric_insert_owner']){
  assert.match(sql,new RegExp('CREATE POLICY v2_device_ingest_'+name+'_candidate[\\s\\S]*?auth\\.uid\\(\\)'));
 }
 assert.match(sql,/CREATE POLICY v2_device_ingest_activity_lock_owner_candidate[\s\S]*?FOR UPDATE TO allin_v2_device_ingest[\s\S]*?auth\.uid\(\)/);
 assert.match(sql,/CREATE POLICY v2_device_ingest_source_lock_owner_candidate[\s\S]*?FOR UPDATE TO allin_v2_device_ingest[\s\S]*?auth\.uid\(\)/);
 assert.match(sql,/Verified athlete owner binding required/);
 assert.match(sql,/IF \(SELECT auth\.uid\(\)\) IS NULL OR \(SELECT auth\.uid\(\)\) <> p_owner_id/);
});
test('canonical writer and nonce uniqueness remain transactionally coupled',()=>{
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/ON CONFLICT\(nonce_hash\) DO NOTHING/);
 assert.match(sql,/v2_activity_append_scalar_candidate\(/);
 assert.match(sql,/SECURITY INVOKER/);
});
