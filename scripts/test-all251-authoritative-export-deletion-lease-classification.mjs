// ALL-251: source-anchored regression checks for the ONE canonical export
// inventory. PostgreSQL runtime tests cover deletion graph separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync('docs/architecture/sql/V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql','utf8');
const sourceOwner=readFileSync('docs/architecture/sql/V2-ACCOUNT-DELETION-OWNER-GRAPH-PREFLIGHT-REVIEW.sql','utf8');

test('canonical export inventories Storage lease ledger only as protected internal operational state',()=>{
 assert.match(source,/Privileged Storage lease ledger or write\/delete fences changed/);
 assert.match(source,/v2_privileged_storage_write_leases_review/);
 for(const required of [
  'c.relrowsecurity','fk.confdeltype=\'c\'',
  "has_table_privilege('authenticated'",
  'v2_privileged_storage_write_fence_review',
  'v2_privileged_storage_auth_delete_fence_review',
  'v2_privileged_storage_metadata_write_fence_review'
 ])assert.ok(source.includes(required),'Missing preservation guard '+required);
 assert.match(source,/Unreviewed alternate-key owner table requires export coverage/);
 assert.match(source,/'complete',false/);
 assert.match(source,/Storage bytes have no approved paginated export reader/);
 assert.ok(!source.includes("'complete',true"),'Cannot enable incomplete full account export');
});

test('deletion scanner includes the same durable Storage fences and refuses unapproved buckets',()=>{
 for(const term of [
  'missing_or_unsecured_privileged_write_lease_ledger',
  'missing_privileged_storage_deletion_or_auth_fence',
  'missing_privileged_storage_metadata_write_fence',
  'unreviewed_storage_bucket_cleanup',
  'join_only_owner_child_without_verified_auth_cascade'
 ])assert.ok(sourceOwner.includes(term),'Missing deletion coverage fail-closed reason '+term);
 assert.match(sourceOwner,/no_verified_auth_cascade_path/);
 assert.match(sourceOwner,/audit_retention_policy_required/);
 assert.match(sourceOwner,/relationship_or_actor_retention_policy_required/);
});
