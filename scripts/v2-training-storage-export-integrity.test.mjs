import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyTrainingExportObjects } from './v2-training-storage-export-integrity.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const activity = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bytes = Buffer.from('synthetic private workout measurements');
const digest = createHash('sha256').update(bytes).digest('hex');
const path = owner + '/' + 'a'.repeat(64) + '/series.fit';
const record = () => ({
  kind:'series',user_id:owner,activity_id:activity,source_id:source,
  state:'ready', object_path:path, checksum_sha256:digest,
});
const run = (meta=[record()],objects=[{path,bytes}]) =>
  verifyTrainingExportObjects({ownerId:owner,metadata:meta,fetchedObjects:objects});

test('verifies actual supplied bytes and creates incomplete non-authorizing manifest', () => {
 const result=run();
 assert.equal(result.verifiedFileCount,1);
 assert.equal(result.files[0].checksumSha256,digest);
 assert.equal(result.completeUserExport,false);
 assert.equal(result.storageAuthorizationVerified,false);
});
test('never accepts a foreign owner or mismatched source identity', () => {
 assert.throws(()=>run([{...record(),user_id:foreign}]),/foreign owner/);
 assert.throws(()=>verifyTrainingExportObjects({ownerId:foreign,metadata:[record()],fetchedObjects:[{path,bytes}]}),/foreign owner/);
});
test('fails on missing files, altered bytes and unexpected extra objects', () => {
 assert.throws(()=>run([record()],[]),/Missing/);
 assert.throws(()=>run([record()],[{path,bytes:Buffer.from('changed')}]),/checksum/);
 assert.throws(()=>run([record()],[{path,bytes},{path:owner+'/extra',bytes}]),/Unlisted/);
});
test('fails on duplicate objects, unsafe paths, and unreviewed states', () => {
 assert.throws(()=>run([record(),record()]),/repeated/);
 assert.throws(()=>run([record()],[{path,bytes},{path,bytes}]),/Duplicate/);
 assert.throws(()=>run([{...record(),object_path:owner+'/../'+ 'a'.repeat(64)}]),/identity/);
 assert.throws(()=>run([{...record(),state:'pending'}]),/Unreviewed/);
 assert.throws(()=>run([{...record(),kind:'route',privacy_state:'public'}]),/Unreviewed/);
});
test('accepts private reviewed route only when bytes are present and correct', () => {
 const route = {...record(),kind:'route',privacy_state:'private'};
 assert.equal(run([route]).files[0].kind,'route');
});
test('empty manifest stays incomplete and rejects unlisted bytes', () => {
 assert.equal(run([],[]).completeUserExport,false);
 assert.throws(()=>run([],[{path,bytes}]),/Unlisted/);
});
