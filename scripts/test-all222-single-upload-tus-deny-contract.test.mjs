// ALL-222 source-level guard against unintentionally enabling private TUS
// at the existing single-request writer. Does not replace hosted HTTP proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/v2-private-storage-writer/index.ts',import.meta.url),'utf8');

test('trusted single-request writer explicitly rejects TUS session and chunk ingress',()=>{
  assert.match(source,/req\.method\s*!==\s*'POST'/);
  for(const header of ['tus-resumable','upload-offset','upload-length',
                       'upload-metadata','upload-defer-length']){
    assert(source.includes("req.headers.has('"+header+"')"),
      'Missing explicit TUS ingress denial for '+header);
  }
  assert(source.includes("return reply(403,'resumable_upload_disabled')"),
    'TUS denial must fail closed');
  assert(source.includes('application\\/offset\\+octet-stream'),
    'TUS chunk media type must fail closed');
});

test('existing complete-upload authorization and durable attested barrier retained',()=>{
  assert(source.includes("ALLIN_PRIVATE_WRITER_ACCEPTED")&&
         source.includes("private_writer_not_accepted"));
  assert(source.includes("client.auth.getUser("));
  assert(source.includes("createAttestedPrivilegedStorageLeaseAuthority("));
  assert(source.includes("requireAttestedLease:true"));
  assert(source.includes("verifiedOwnerId:identity.data.user.id"));
  assert(source.includes("MAX_PRIVILEGED_STORAGE_BYTES"));
});

test('operator active-termination mode never marks acceptance before fixture cleanup',()=>{
 const runner=readFileSync(new URL('./test-all222-operator-attested-tus-resume.mjs',import.meta.url),'utf8');
 assert(runner.includes("ALL222_TERMINATION_FIXTURE_CLEANUP_ACK"),'Manual cleanup acknowledgement required');
 assert(runner.includes("CHECKPOINT: provider TUS termination"),'Provider evidence remains provisional');
 assert(runner.includes("BLOCKED: reconcile tagged synthetic lease"),'Retained fixture must be explicit');
 assert(runner.includes("process.exitCode=2"),'Partial acceptance must exit nonzero');
 assert(runner.includes("PARTIAL: active TUS termination"),'No complete PASS on retained fixture');
 assert(!runner.includes("PASS ALL-222 active TUS termination and lease cancellation; operator fixture cleanup pending"),
  'Misleading acceptance on unresolved cleanup is forbidden');
});

test('staging cleanup candidate is rollback-only and exact synthetic owner guarded',()=>{
 const file=readFileSync(new URL('./fixtures/all222-hosted-termination-cleanup-dryrun-review.sql',import.meta.url),'utf8');
 assert.match(file,/ROLLBACK;\\s*$/);
 assert.equal((file.match(/^ROLLBACK;$/gm)??[]).length,1,'Only one terminal ROLLBACK is allowed');
 assert.equal((file.match(/^DO \\$all222\\$$/gm)??[]).length,1,'Duplicate reconciliation blocks are forbidden');
 assert.equal((file.match(/^\\$all222\\$;$/gm)??[]).length,1,'Single completed DO body required');
 assert(file.includes("v_row.writer_sha256_review !~ '^[0-9a-f]{64}$'"),
   'The attested digest regex must be complete and correctly quoted');
 assert.doesNotMatch(file,/^\\s*COMMIT\\s*;/mi);
 assert(file.includes("all222_fixture'='terminate-active'"));
 assert(file.includes("all222_disposable'='true'"));
 assert(file.includes("pg_advisory_xact_lock"));
 assert(file.includes("v_row.cancelled_at IS NULL"));
 assert(file.includes("v_row.settled_at IS NOT NULL"));
 assert(file.includes("Additional leases exist: reconciliation denied"));
 assert(file.includes("Private Storage objects remain: reconciliation denied"));
 assert(file.includes("Account deletion request present: reconciliation denied"));
 assert(file.includes("00000000-0000-0000-0000-000000000000"));
});

test('isolated populated cleanup replay never contacts hosted Supabase',()=>{
 const outer=readFileSync(new URL('./run-all222-hosted-cleanup-isolated-replay.sh',import.meta.url),'utf8');
 const inner=readFileSync(new URL('./fixtures/all222-hosted-cleanup-replay-inside.sh',import.meta.url),'utf8');
 const fixture=readFileSync(new URL('./fixtures/all222-hosted-cleanup-populated-replay-bootstrap.sql',import.meta.url),'utf8');
 assert(outer.includes('ALL222_ISOLATED_REPLAY_APPROVED'));
 assert(outer.includes('--pull=never')&&outer.includes('--network=none'));
 assert(outer.includes('--read-only')&&outer.includes('readonly'));
 assert(outer.includes('postgres:16'));
 assert(outer.includes('all222-hosted-cleanup-replay-inside.sh'));
 assert(inner.includes('all222-hosted-termination-cleanup-dryrun-review.sql'));
 assert(inner.includes('all222-hosted-cleanup-populated-replay-bootstrap.sql'));
 assert(inner.includes('PASS: isolated cleanup replay complete'));
 for(const denial of ['impossible UUID placeholders','untagged owner','extra owner lease',
   'object-present owner','deletion record','active lease']){
   assert(inner.includes('FAIL: '+denial),'Missing isolated denial: '+denial);
 }
 assert(fixture.includes('all222_fixture')&&fixture.includes('cancelled_at'));
 assert(!outer.includes('SUPABASE_SERVICE_ROLE_KEY')&&!inner.includes('SUPABASE_SERVICE_ROLE_KEY'));
 assert(!outer.includes('https://')&&!inner.includes('https://'));
});
