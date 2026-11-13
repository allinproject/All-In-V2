/**
 * ALL-251 REVIEW ONLY: byte absence must be verified via privileged Storage
 * API readback, never by trusting Postgres storage.objects rows or an in-memory
 * checkpoint. Immutable plans MUST be from the canonical private DB reader.
 *
 * This cannot prove the upload writer freeze and must not be treated as a
 * production deletion-readiness attestation on its own.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET=/^[a-z0-9][a-z0-9-]{1,80}$/;
const MAX_FILES=10000;
const validPath=(p,owner)=>typeof p==='string' && p.length<=1024 &&
 p.startsWith(owner+'/') &&
 p.split('/').every(x=>x && x!=='.' && x!=='..' && !/[\\\u0000-\u001f]/.test(x));
export async function verifyPrivateStorageByteAbsenceReview({
 ownerId,requestId,approvedBucketIds,listBucketCatalog,
 readExistingObjectPlan,listOwnerStorageObjects,objectExists,objectBytesAbsent,
 verifyBucketCheckpoints,assertOwnerWritesQuiesced,
}) {
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'')||
  !Array.isArray(approvedBucketIds)||approvedBucketIds.length<1||
  new Set(approvedBucketIds).size!==approvedBucketIds.length||
  approvedBucketIds.some(id=>!BUCKET.test(id))||
  [listBucketCatalog,readExistingObjectPlan,listOwnerStorageObjects,
   objectExists,objectBytesAbsent,verifyBucketCheckpoints,assertOwnerWritesQuiesced]
   .some(x=>typeof x!=='function'))
  throw Error('Trusted Storage absence verification dependencies required');
 async function barrier() {
  if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
   throw Error('Authoritative owner upload barrier unavailable');
 }
 async function catalog() {
  const rows=await listBucketCatalog();
  if(!Array.isArray(rows)||rows.length!==approvedBucketIds.length||
   rows.some(b=>!b||!approvedBucketIds.includes(b.id)||b.public!==false)||
   new Set(rows.map(b=>b.id)).size!==rows.length)
   throw Error('Storage bucket coverage changed or incomplete');
 }
 await barrier();await catalog();
 let count=0;
 for(const bucketId of approvedBucketIds){
  await barrier();
  // Never create/extend a manifest in a read-only verification operation.
  const plan=await readExistingObjectPlan({ownerId,requestId,bucketId});
  if(plan?.durable!==true||plan.ownerId!==ownerId||
   plan.requestId!==requestId||plan.bucketId!==bucketId||
   !Array.isArray(plan.paths)||plan.paths.length>MAX_FILES||
   new Set(plan.paths).size!==plan.paths.length||
   plan.paths.some(p=>!validPath(p,ownerId)))
    throw Error('Canonical immutable owner Storage plan unavailable');
  count+=plan.paths.length;
  if(count>MAX_FILES)throw Error('Storage verification object count exceeded');
  if(await verifyBucketCheckpoints({
   ownerId,requestId,bucketId,plannedCount:plan.paths.length,
  })!==true)throw Error('Durable Storage checkpoint coverage incomplete');
  for(const path of plan.paths){
   await barrier();
   if(await objectExists({ownerId,requestId,bucketId,path})!==false)
    throw Error('Private Storage object still present or unverifiable');
   if(await objectBytesAbsent({ownerId,requestId,bucketId,path})!==true)
    throw Error('Private Storage bytes remain downloadable or unverified');
  }
  // The provider's exhaustive owner listing must also detect paths omitted
  // from the plan (e.g. malicious late uploads).
  const inventory=await listOwnerStorageObjects({ownerId,requestId,bucketId});
  if(inventory?.ownerId!==ownerId||inventory?.bucketId!==bucketId||
     inventory.exhaustive!==true||inventory.totalCount!==0||
     !Array.isArray(inventory.paths)||inventory.paths.length!==0)
   throw Error('Owner Storage inventory not empty after byte readback');
  await barrier();
 }
 await catalog();await barrier();
 return Object.freeze({ownerId,requestId,reviewOnly:true,
  storageApiAbsenceVerified:true,checkpointCoverageVerified:true,
  approvedBucketCount:approvedBucketIds.length,plannedObjectCount:count});
}
