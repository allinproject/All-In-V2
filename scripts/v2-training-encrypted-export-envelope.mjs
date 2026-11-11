/**
 * ALL-251 REVIEW ONLY — bounded encrypted private workout payload envelope.
 * SERVER ONLY: the 32-byte encryption key must come from a trusted key service,
 * never from a user request or mobile bundle. This is not a deployed archive
 * worker, signed-URL service, or complete user-data export.
 *
 * Envelope v1: AES-256-GCM of an ordered, JSON/base64 private file payload.
 * AAD binds owner, request and envelope version; authentication tag detects
 * alteration. The envelope includes no key or plaintext. Before production,
 * replace in-memory payloads with a streaming, TTL-governed archive backend.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const VERSION='allin-v2-training-encrypted-export-v1';
const CAP_BYTES=16*1024*1024;
const CAP_FILES=128;

function checkedInput({ownerId,requestId,verifiedManifest,files,encryptionKey}) {
 if (!UUID.test(ownerId??'') || !UUID.test(requestId??'')
  || !(encryptionKey instanceof Uint8Array) || encryptionKey.byteLength!==32
  || !verifiedManifest || verifiedManifest.ownerId!==ownerId
  || verifiedManifest.completeUserExport!==false
  || verifiedManifest.storageAuthorizationVerified!==false
  || !Array.isArray(verifiedManifest.files) || !Array.isArray(files)
  || verifiedManifest.files.length!==files.length || files.length>CAP_FILES) {
  throw new Error('Invalid encrypted export inputs');
 }
 const expected=new Map();
 for(const entry of verifiedManifest.files) {
  if (!entry || typeof entry.objectPath!=='string'
    || !entry.objectPath.startsWith(ownerId+'/') || expected.has(entry.objectPath)
    || !SHA.test(entry.checksumSha256??'') || !UUID.test(entry.activityId??'')
    || !UUID.test(entry.sourceId??'') || !['series','route'].includes(entry.kind)) {
   throw new Error('Unsafe verified export manifest');
  }
  expected.set(entry.objectPath,entry);
 }
 const seen=new Set();
 let totalBytes=0;
 const payload=[];
 for(const file of files) {
  if (!file || typeof file.path!=='string' || !(file.bytes instanceof Uint8Array)
   || seen.has(file.path) || !expected.has(file.path)) {
   throw new Error('Unexpected encrypted export file');
  }
  seen.add(file.path);
  const meta=expected.get(file.path);
  const length=file.bytes.byteLength;
  totalBytes+=length;
  if(length===0 || totalBytes>CAP_BYTES || meta.byteLength!==length
   || createHash('sha256').update(file.bytes).digest('hex')!==meta.checksumSha256) {
   throw new Error('Encrypted export bytes do not match verified manifest');
  }
  payload.push({kind:meta.kind,path:file.path,activityId:meta.activityId,
    sourceId:meta.sourceId,sha256:meta.checksumSha256,bytes:Buffer.from(file.bytes).toString('base64')});
 }
 if(seen.size!==expected.size)throw new Error('Missing file from encrypted export');
 return {totalBytes,payload:payload.sort((a,b)=>a.path.localeCompare(b.path))};
}
export function encryptVerifiedTrainingExport(input) {
 const {ownerId,requestId,encryptionKey}=input;
 const {payload,totalBytes}=checkedInput(input);
 const iv=randomBytes(12);
 const aad=Buffer.from(JSON.stringify([VERSION,ownerId,requestId]),'utf8');
 const cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
 cipher.setAAD(aad);
 const plain=Buffer.from(JSON.stringify({version:VERSION,ownerId,requestId,files:payload}),'utf8');
 const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 const tag=cipher.getAuthTag();
 // Caller must store the envelope only in a private, expiring backend record.
 return {version:VERSION,ownerId,requestId,fileCount:payload.length,
   sourceByteLength:totalBytes,algorithm:'AES-256-GCM',
   iv:iv.toString('base64'),tag:tag.toString('base64'),
   ciphertext:encrypted.toString('base64'),
   completeUserExport:false,downloadAuthorized:false};
}
/** Test/operator-only decoder; never attach to a mobile or public API. */
export function decryptTrainingExportForVerification(envelope,encryptionKey,expectedOwner,expectedRequest) {
 if (!envelope || envelope.version!==VERSION
   || envelope.ownerId!==expectedOwner || envelope.requestId!==expectedRequest
   || !(encryptionKey instanceof Uint8Array) || encryptionKey.byteLength!==32) {
  throw new Error('Invalid encrypted envelope');
 }
 const iv=Buffer.from(envelope.iv,'base64');
 const tag=Buffer.from(envelope.tag,'base64');
 if(iv.length!==12||tag.length!==16)throw new Error('Invalid encrypted envelope parameters');
 const aad=Buffer.from(JSON.stringify([VERSION,expectedOwner,expectedRequest]),'utf8');
 const decipher=createDecipheriv('aes-256-gcm',encryptionKey,iv);
 decipher.setAAD(aad);
 decipher.setAuthTag(tag);
 const clear=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);
 const parsed=JSON.parse(clear.toString('utf8'));
 if(parsed.ownerId!==expectedOwner||parsed.requestId!==expectedRequest||parsed.version!==VERSION)
  throw new Error('Invalid decrypted payload identity');
 return parsed;
}
