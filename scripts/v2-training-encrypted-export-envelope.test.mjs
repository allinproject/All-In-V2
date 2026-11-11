import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {encryptVerifiedTrainingExport,decryptTrainingExportForVerification}
 from './v2-training-encrypted-export-envelope.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activityId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const path=owner+'/'+ 'x'.repeat(64)+'/series.fit';
const bytes=Buffer.from('private-structured-workout-telemetry');
const sha=createHash('sha256').update(bytes).digest('hex');
const key=randomBytes(32);
function args() {return {ownerId:owner,requestId,encryptionKey:key,
 verifiedManifest:{ownerId:owner,completeUserExport:false,storageAuthorizationVerified:false,
 files:[{kind:'series',objectPath:path,activityId,sourceId,byteLength:bytes.length,checksumSha256:sha}]},
 files:[{path,bytes}]};}
test('authenticated envelope roundtrip binds owner, request, and actual file hash',()=>{
 const out=encryptVerifiedTrainingExport(args());
 assert.equal(out.completeUserExport,false);
 assert.equal(out.downloadAuthorized,false);
 assert.equal(out.fileCount,1);
 assert.equal(out.sourceByteLength,bytes.length);
 assert.equal(JSON.stringify(out).includes('private-structured-workout-telemetry'),false);
 const decoded=decryptTrainingExportForVerification(out,key,owner,requestId);
 assert.equal(Buffer.from(decoded.files[0].bytes,'base64').toString(),bytes.toString());
 assert.equal(decoded.files[0].sha256,sha);
});
test('ciphertext and authentication tag tampering fail closed',()=>{
 const out=encryptVerifiedTrainingExport(args());
 const ciphertext=Buffer.from(out.ciphertext,'base64');
 ciphertext[0]^=1;
 assert.throws(()=>decryptTrainingExportForVerification(
  {...out,ciphertext:ciphertext.toString('base64')},key,owner,requestId));
 const tag=Buffer.from(out.tag,'base64');tag[0]^=1;
 assert.throws(()=>decryptTrainingExportForVerification(
  {...out,tag:tag.toString('base64')},key,owner,requestId));
});
test('wrong owner, request or key cannot decrypt',()=>{
 const out=encryptVerifiedTrainingExport(args());
 assert.throws(()=>decryptTrainingExportForVerification(out,key,
  '22222222-2222-4222-8222-222222222222',requestId),/Invalid/);
 assert.throws(()=>decryptTrainingExportForVerification(out,key,owner,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),/Invalid/);
 assert.throws(()=>decryptTrainingExportForVerification(out,randomBytes(32),owner,requestId));
});
test('invalid manifest, foreign path, missing files and modified bytes rejected',()=>{
 const original=args();
 assert.throws(()=>encryptVerifiedTrainingExport({
  ...original,verifiedManifest:{...original.verifiedManifest,ownerId:'other'},
 }),/Invalid/);
 assert.throws(()=>encryptVerifiedTrainingExport({
  ...original,verifiedManifest:{...original.verifiedManifest,
   files:[{...original.verifiedManifest.files[0],objectPath:'foreign/'+path}]},
 }),/Unsafe/);
 assert.throws(()=>encryptVerifiedTrainingExport({...original,files:[]}),/Invalid/);
 assert.throws(()=>encryptVerifiedTrainingExport({
  ...original,files:[{path,bytes:Buffer.from('modified')}]},
 ),/match/);
 assert.throws(()=>encryptVerifiedTrainingExport({...original,encryptionKey:Buffer.alloc(8)}),/Invalid/);
});
test('no duplicate files or unexpected supplementary bytes',()=>{
 const original=args();
 assert.throws(()=>encryptVerifiedTrainingExport({
  ...original,files:[{path,bytes},{path,bytes}],
  verifiedManifest:{...original.verifiedManifest,
   files:[original.verifiedManifest.files[0],original.verifiedManifest.files[0]]},
 }),/Unsafe/);
});
test('random nonce per envelope prevents deterministic ciphertext reuse',()=>{
 const a=encryptVerifiedTrainingExport(args());
 const b=encryptVerifiedTrainingExport(args());
 assert.notEqual(a.iv,b.iv);
 assert.notEqual(a.ciphertext,b.ciphertext);
});
