/**
 * ALL-251 REVIEW CANDIDATE ONLY. Not wired to deletion claims or production.
 * Storage API operations must be provided by an authenticated SERVER worker.
 * A bucket allowlist, complete owner inventory, and durable per-object audit
 * are mandatory. No SQL-only deletion of storage.objects is permitted.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OBJECTS=10000;
const validPath=(path,ownerId)=>typeof path==='string' &&
 path.startsWith(ownerId+'/') && path.length<=1024 &&
 path.split('/').every(segment=>segment && segment!=='.' && segment!=='..' &&
 !/[\\\u0000-\u001f]/.test(segment));

function validateInventory(inventory,ownerId,bucketId) {
 if(inventory?.ownerId!==ownerId || inventory?.bucketId!==bucketId ||
    inventory.exhaustive!==true || !Array.isArray(inventory.paths) ||
    !Number.isSafeInteger(inventory.totalCount) ||
    inventory.totalCount!==inventory.paths.length ||
    inventory.paths.length>MAX_OBJECTS)
   throw Error('Incomplete or mismatched private Storage inventory');
 const paths=[...inventory.paths];
 if(new Set(paths).size!==paths.length ||
    paths.some(path=>!validPath(path,ownerId)))
   throw Error('Foreign, duplicate, or invalid private Storage path');
 return paths.sort();
}

/**
 * Returns a cleanup review receipt only after readback confirms absence.
 * Caller MUST NOT treat this receipt as release approval or enable deletion.
 * Persisted checkpoints must be keyed by (ownerId, requestId, bucketId, path)
 * with idempotent upsert, and must NEVER be trusted in place of object readback.
 */
export async function reviewPrivateStorageCleanup({
 ownerId,requestId,approvedBucketIds,listBucketCatalog,listOwnerStorageObjects,
 deleteObject,objectExists,recordCheckpoint,
}) {
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'') ||
    !Array.isArray(approvedBucketIds) || !approvedBucketIds.length ||
    new Set(approvedBucketIds).size!==approvedBucketIds.length ||
    approvedBucketIds.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) ||
    [listBucketCatalog,listOwnerStorageObjects,deleteObject,objectExists,recordCheckpoint]
      .some(fn=>typeof fn!=='function'))
   throw Error('Approved server-only cleanup dependencies required');
 const buckets=await listBucketCatalog();
 if(!Array.isArray(buckets) || buckets.some(b=>typeof b?.id!=='string'))
   throw Error('Storage bucket catalog not authoritative');
 // Refuse unreviewed buckets, even if they happen to contain no owner objects.
 if(buckets.length!==approvedBucketIds.length ||
    approvedBucketIds.some(id=>!buckets.some(b=>b.id===id&&b.public===false)))
   throw Error('Unreviewed Storage bucket coverage');
 const receipt=[];
 for(const bucketId of approvedBucketIds) {
   const inventory=await listOwnerStorageObjects({ownerId,requestId,bucketId});
   const paths=validateInventory(inventory,ownerId,bucketId);
   for(const path of paths) {
     // Before each destructive request, re-check ownership and existence.
     if(!validPath(path,ownerId))throw Error('Invalid owner path');
     const existed=await objectExists({ownerId,requestId,bucketId,path});
     if(typeof existed!=='boolean')throw Error('Unverifiable Storage existence');
     if(existed) {
       const result=await deleteObject({ownerId,requestId,bucketId,path});
       if(result?.deleted!==true && result?.alreadyAbsent!==true)
         throw Error('Storage API delete was not acknowledged');
     }
     const remaining=await objectExists({ownerId,requestId,bucketId,path});
     if(remaining!==false)throw Error('Storage object still exists after delete');
     await recordCheckpoint({ownerId,requestId,bucketId,path,state:'absent_verified'});
     receipt.push({bucketId,path,state:'absent_verified'});
   }
   const finalInventory=await listOwnerStorageObjects({ownerId,requestId,bucketId});
   if(validateInventory(finalInventory,ownerId,bucketId).length!==0)
     throw Error('Storage owner inventory not empty after cleanup');
 }
 return {ownerId,requestId,reviewOnly:true,completeInventoryRechecked:true,
   verifiedAbsent:receipt.length,receipt};
}
