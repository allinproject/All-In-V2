/**
 * ALL-251 REVIEW CANDIDATE ONLY. Not wired to deletion claims or production.
 * Storage API operations must be provided by an authenticated SERVER worker.
 * A bucket allowlist, complete owner inventory, and durable per-object audit
 * are mandatory. No SQL-only deletion of storage.objects is permitted.
 * A real owner-write barrier is also required; listing twice is insufficient
 * if another session can upload between readback and Auth deletion.
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
 * A durable immutable object plan MUST be written before the first delete;
 * otherwise a crash between Storage deletion and checkpoint loses evidence.
 */
export async function reviewPrivateStorageCleanup({
 ownerId,requestId,approvedBucketIds,listBucketCatalog,listOwnerStorageObjects,
 deleteObject,objectExists,recordCheckpoint,readCheckpoint,persistAndLoadObjectPlan,
 assertOwnerWritesQuiesced,
}) {
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'') ||
    !Array.isArray(approvedBucketIds) || !approvedBucketIds.length ||
    new Set(approvedBucketIds).size!==approvedBucketIds.length ||
    approvedBucketIds.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) ||
    [listBucketCatalog,listOwnerStorageObjects,deleteObject,objectExists,recordCheckpoint,
     readCheckpoint,persistAndLoadObjectPlan,assertOwnerWritesQuiesced]
      .some(fn=>typeof fn!=='function'))
   throw Error('Approved server-only cleanup dependencies required');
 // Only an authoritative server-side writer barrier can establish this.
 // Never accept an app/client assertion or a mere absence of current uploads.
 if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
   throw Error('Owner Storage writes are not authoritatively quiesced');
 const buckets=await listBucketCatalog();
 if(!Array.isArray(buckets) || buckets.some(b=>typeof b?.id!=='string'))
   throw Error('Storage bucket catalog not authoritative');
 // Refuse unreviewed buckets, even if they happen to contain no owner objects.
 if(buckets.length!==approvedBucketIds.length ||
    approvedBucketIds.some(id=>!buckets.some(b=>b.id===id&&b.public===false)))
   throw Error('Unreviewed Storage bucket coverage');
 const receipt=[];
 for(const bucketId of approvedBucketIds) {
   if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
     throw Error('Owner Storage write barrier expired');
   const inventory=await listOwnerStorageObjects({ownerId,requestId,bucketId});
   const currentlyPresent=validateInventory(inventory,ownerId,bucketId);
   // Persist the exact scoped object plan before ANY deletion. On retry,
   // previously removed files still occur in this plan and must get audited.
   // The canonical server plan must be immutable for this request; new
   // objects appearing outside it are a fatal write-barrier failure.
   const plan=await persistAndLoadObjectPlan({ownerId,requestId,bucketId,
     observedPaths:currentlyPresent});
   if(plan?.durable!==true||plan?.ownerId!==ownerId||
      plan?.requestId!==requestId||plan?.bucketId!==bucketId)
     throw Error('Durable Storage object plan unavailable');
   const paths=validateInventory({ownerId,bucketId,exhaustive:true,
     totalCount:plan.paths?.length,paths:plan.paths},ownerId,bucketId);
   if(currentlyPresent.some(path=>!paths.includes(path)))
     throw Error('Unplanned owner Storage object discovered');
   for(const path of paths) {
     if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
       throw Error('Owner Storage write barrier expired before object cleanup');
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
     if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
       throw Error('Owner Storage write barrier expired before checkpoint');
     const scope={ownerId,requestId,bucketId,path};
     const saved=await recordCheckpoint({...scope,state:'absent_verified'});
     if(saved?.persisted!==true)throw Error('Storage checkpoint not persisted');
     const verified=await readCheckpoint(scope);
     if(verified?.ownerId!==ownerId || verified?.requestId!==requestId ||
        verified?.bucketId!==bucketId || verified?.path!==path ||
        verified?.state!=='absent_verified')
       throw Error('Storage checkpoint readback not verified');
     receipt.push({bucketId,path,state:'absent_verified'});
   }
   if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
     throw Error('Owner Storage write barrier expired');
   const finalInventory=await listOwnerStorageObjects({ownerId,requestId,bucketId});
   if(validateInventory(finalInventory,ownerId,bucketId).length!==0)
     throw Error('Storage owner inventory not empty after cleanup');
 }
 if(await assertOwnerWritesQuiesced({ownerId,requestId})!==true)
   throw Error('Owner Storage write barrier expired');
 const finalBuckets=await listBucketCatalog();
 if(!Array.isArray(finalBuckets)||finalBuckets.length!==approvedBucketIds.length ||
    approvedBucketIds.some(id=>!finalBuckets.some(b=>b.id===id&&b.public===false)))
   throw Error('Storage bucket catalog changed during cleanup');
 return {ownerId,requestId,reviewOnly:true,writeBarrierVerified:true,completeInventoryRechecked:true,
   verifiedAbsent:receipt.length,receipt};
}
