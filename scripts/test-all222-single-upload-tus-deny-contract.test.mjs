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
