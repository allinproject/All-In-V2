/**
 * ALL-251 REVIEW ONLY — independent private-media inventory gate for the
 * EXISTING account-export worker. This audits approved Training series/routes,
 * not a second export API and not a release of every future media domain.
 *
 * Trusted service-side adapters must provide complete, paginated owner-path
 * listings and canonical owner references. The gate compares identities AND
 * actual bytes. It refuses orphan objects, missing files, public buckets,
 * unknown media buckets, duplicate paths and mismatched SHA-256.
 *
 * Successful Training coverage still reports completeUserExport:false:
 * Community images, nutrition photos and other domain media require their
 * own approved source contracts before the canonical inventory can be complete.
 */
import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const PRIVATE_EVIDENCE='v2-private-workout-objects';
const PRIVATE_OUTPUT='v2-private-account-exports';
const MAX_ITEMS=512;
const MAX_BYTES=16*1024*1024;

function validPath(ownerId,path){
 return typeof path==='string' && path.startsWith(ownerId+'/')
  && path.length>=ownerId.length+3 && path.length<=500
  && !path.includes('..') && !path.includes('//')
  && !path.includes('\\') && !/[?#%]/.test(path);
}
export async function auditPrivateMediaExportCoverage({
 ownerId,requestId,listBuckets,listCanonicalEvidence,
 listOwnerStorageObjects,readVerifiedObject,
}) {
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'')
  ||[listBuckets,listCanonicalEvidence,listOwnerStorageObjects,readVerifiedObject]
    .some(fn=>typeof fn!=='function')) throw Error('Trusted private media audit dependencies required');
 const buckets=await listBuckets();
 if(!Array.isArray(buckets)||buckets.some(b=>typeof b?.id!=='string'
    ||b.public!==false||![PRIVATE_EVIDENCE,PRIVATE_OUTPUT].includes(b.id))
    ||new Set(buckets.map(b=>b.id)).size!==buckets.length)
   throw Error('Unknown or public Storage bucket requires privacy review');
 const canonical=await listCanonicalEvidence({ownerId,requestId});
 if(canonical?.ownerId!==ownerId||canonical?.sourceCoverageComplete!==true
    ||!Array.isArray(canonical.records)||canonical.records.length>MAX_ITEMS)
   throw Error('Incomplete canonical private media source coverage');
 const requested=new Map();
 for(const item of canonical.records){
  if(item?.user_id!==ownerId
    ||!['series','route'].includes(item?.kind)
    ||!validPath(ownerId,item?.object_path)
    ||!SHA.test(item?.checksum_sha256??'')
    ||requested.has(item.object_path)
    ||item.state!=='ready'
    ||(item.kind==='route'&&!['private','redacted'].includes(item.privacy_state)))
     throw Error('Invalid or duplicate canonical private media reference');
  requested.set(item.object_path,item);
 }
 // Require a complete listing rather than treating empty/first pages as none.
 const listed=await listOwnerStorageObjects({ownerId,requestId,bucket:PRIVATE_EVIDENCE});
 if(listed?.ownerId!==ownerId||listed.bucket!==PRIVATE_EVIDENCE
    ||listed.complete!==true||!Array.isArray(listed.objects)
    ||listed.objects.length>MAX_ITEMS)
   throw Error('Incomplete private Storage owner-path listing');
 const names=new Set();
 for(const object of listed.objects){
  const path=object?.path;
  if(!validPath(ownerId,path)||names.has(path)
    ||!Number.isSafeInteger(object?.size)||object.size<1||object.size>MAX_BYTES)
    throw Error('Invalid or duplicate private Storage object');
  names.add(path);
 }
 if(names.size!==requested.size||[...names].some(path=>!requested.has(path)))
   throw Error('Private Storage and canonical owner references do not match');
 let totalBytes=0;
 for(const path of [...names].sort()){
  const reference=requested.get(path);
  const bytes=await readVerifiedObject({ownerId,requestId,
    bucket:PRIVATE_EVIDENCE,path,kind:reference.kind});
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>MAX_BYTES)
   throw Error('Private Storage bytes unavailable or oversized');
  const actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==reference.checksum_sha256)
   throw Error('Private Storage bytes fail canonical SHA-256');
  totalBytes+=bytes.byteLength;
 }
 return Object.freeze({
  ownerId,requestId,reviewedSource:'training_activity_evidence_v1',
  verifiedObjects:names.size,verifiedBytes:totalBytes,
  exactPathCoverage:true,checksumVerified:true,
  completeUserExport:false,
  unresolvedDomains:['community_media','nutrition_media','progress_media','other_owner_media'],
 });
}
