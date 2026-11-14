/**
 * ALL-251 REVIEW ONLY: Community photo coverage for the EXISTING private
 * account-export/deletion architecture. No new owner system or source registry.
 * The canonical rows are allin_private.v2_community_post_photos, joined to
 * allin_private.v2_community_posts by (post_id, owner_id).
 *
 * This diagnostic does NOT amend training export bucket allowlists, produce
 * an archive, release deletion, grant Storage access or approve a new bucket.
 * The production export/deletion release gates deliberately remain OFF.
 */
import {createHash} from 'node:crypto';
import {verifyPrivateStorageByteAbsenceReview} from './trainingDeletionStorageByteAbsenceReview.mjs';

export const REVIEW_COMMUNITY_PHOTO_BUCKET='v2-private-community-photos';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const MAX_PHOTOS=128;
const MAX_BYTES=8*1024*1024;
function assertIdentity(ownerId,requestId){
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??''))
  throw Error('Exact authorized Community photo audit scope required');
}
function rowPath(row,ownerId){
 return ownerId+'/posts/'+row.post_id+'/'+row.id+'.png';
}
function checkRows(rows,ownerId){
 if(!Array.isArray(rows)||rows.length>MAX_PHOTOS)throw Error('Incomplete Community photo owner rows');
 const ids=new Set(),paths=new Set();
 for(const row of rows){
  if(!row||!UUID.test(row.id??'')||!UUID.test(row.post_id??'')||
   row.owner_id!==ownerId||row.post_owner_id!==ownerId||
   row.bucket_id!==REVIEW_COMMUNITY_PHOTO_BUCKET||
   row.content_type!=='image/png'||
   !Number.isSafeInteger(row.post_version)||row.post_version<1||
   !Number.isSafeInteger(row.byte_length)||row.byte_length<1||row.byte_length>MAX_BYTES||
   !Number.isSafeInteger(row.width)||!Number.isSafeInteger(row.height)||
   row.width<1||row.height<1||row.width*row.height>20_000_000||
   !SHA.test(row.sha256??'')||row.object_path!==rowPath(row,ownerId)||
   !['pending','verified','delete_pending'].includes(row.lifecycle)||
   ids.has(row.id)||paths.has(row.object_path))
   throw Error('Invalid, duplicate or cross-owner Community photo source');
  ids.add(row.id);paths.add(row.object_path);
 }
 return paths;
}
/**
 * Caller supplies a privileged, snapshot-pinned canonical JOIN reader,
 * a complete provider object lister, and an owner-scoped readback downloader.
 * All rows including pending/delete_pending must be counted; only verified
 * entries may be considered export-ready. No client-supplied owner or paths.
 */
export async function auditCommunityPhotoCoverageReview({
 ownerId,requestId,listCanonicalPostPhotos,listOwnerStorageObjects,
 downloadPrivatePhoto,listBucketCatalog,
}={}){
 assertIdentity(ownerId,requestId);
 if([listCanonicalPostPhotos,listOwnerStorageObjects,downloadPrivatePhoto,listBucketCatalog]
  .some(fn=>typeof fn!=='function'))
  throw Error('Trusted canonical Community photo audit dependencies required');
 const catalog=await listBucketCatalog({ownerId,requestId});
 if(!Array.isArray(catalog)||new Set(catalog.map(b=>b?.id)).size!==catalog.length||
  !catalog.some(b=>b?.id===REVIEW_COMMUNITY_PHOTO_BUCKET&&b.public===false)||
  catalog.some(b=>b?.id===REVIEW_COMMUNITY_PHOTO_BUCKET&&b.public!==false))
  throw Error('Private Community photo bucket not authoritatively verified');
 const snapshot=await listCanonicalPostPhotos({ownerId,requestId});
 if(snapshot?.ownerId!==ownerId||snapshot?.complete!==true)
  throw Error('Canonical Community photo snapshot truncated or foreign');
 const rows=snapshot.rows;
 const expected=checkRows(rows,ownerId);
 const inventory=await listOwnerStorageObjects({
  ownerId,requestId,bucketId:REVIEW_COMMUNITY_PHOTO_BUCKET,
 });
 if(inventory?.ownerId!==ownerId||inventory.bucketId!==REVIEW_COMMUNITY_PHOTO_BUCKET||
  inventory.exhaustive!==true||inventory.totalCount!==expected.size||
  !Array.isArray(inventory.paths)||inventory.paths.length!==expected.size||
  new Set(inventory.paths).size!==expected.size||
  inventory.paths.some(p=>!expected.has(p)))
  throw Error('Community photo Storage inventory missing, extra or truncated');
 for(const row of rows){
  if(row.lifecycle!=='verified'||!row.verified_at)
   throw Error('Community photo awaiting verification or deletion');
  const bytes=await downloadPrivatePhoto({
   ownerId,requestId,bucketId:REVIEW_COMMUNITY_PHOTO_BUCKET,
   path:row.object_path,photoId:row.id,postId:row.post_id,
  });
  if(!(bytes instanceof Uint8Array)||bytes.length!==row.byte_length||
   createHash('sha256').update(bytes).digest('hex')!==row.sha256)
   throw Error('Community photo bytes missing, changed or mismatched');
 }
 return Object.freeze({
  ownerId,requestId,photosVerified:rows.length,exactOwnerCoverage:true,
  byteChecksumsVerified:true,reviewOnly:true,completeUserExport:false,
  accountDeletionReady:false,
 });
}
/**
 * Reconcile the actual canonical photo owner ledger against the EXISTING
 * immutable Storage deletion plan before any byte-absence claim. The
 * deletion verifier alone cannot know whether omitted canonical rows exist.
 * Keep all pending and delete-pending photo records in the required plan.
 * Never mutate the plan here or declare the whole account deletion complete.
 */
export async function auditCommunityPhotoDeletionPlanReview({
 ownerId,requestId,listCanonicalPostPhotos,readExistingObjectPlan,
 ...deletionDependencies
}={}){
 assertIdentity(ownerId,requestId);
 if(typeof listCanonicalPostPhotos!=='function'||
  typeof readExistingObjectPlan!=='function')
  throw Error('Canonical owner photo and durable deletion plan required');
 const snapshot=await listCanonicalPostPhotos({ownerId,requestId});
 if(snapshot?.ownerId!==ownerId||snapshot.complete!==true)
  throw Error('Incomplete canonical photo deletion source');
 const canonical=checkRows(snapshot.rows,ownerId);
 const plan=await readExistingObjectPlan({
  ownerId,requestId,bucketId:REVIEW_COMMUNITY_PHOTO_BUCKET,
 });
 if(plan?.durable!==true||plan.ownerId!==ownerId||
  plan.requestId!==requestId||plan.bucketId!==REVIEW_COMMUNITY_PHOTO_BUCKET||
  !Array.isArray(plan.paths)||new Set(plan.paths).size!==plan.paths.length||
  plan.paths.length!==canonical.size||
  plan.paths.some(path=>!canonical.has(path)))
  throw Error('Community photo ledger and durable deletion plan diverged');
 const result=await auditCommunityPhotoDeletionAbsenceReview({
  ...deletionDependencies,ownerId,requestId,readExistingObjectPlan,
  approvedBucketIds:[REVIEW_COMMUNITY_PHOTO_BUCKET],
 });
 return Object.freeze({...result,canonicalPhotoCount:canonical.size,
  canonicalPlanReconciled:true,accountDeletionReady:false,
  completePrivateStorage:false,uploadBarrierEnforced:false});
}

/**
 * Exercise the EXISTING immutable-plan and Storage-byte-absence verifier.
 * Requires the caller's authoritative barrier, durable checkpoints and
 * complete exact bucket inventory; cannot unlock operational deletion.
 */
export async function auditCommunityPhotoDeletionAbsenceReview(options={}){
 assertIdentity(options.ownerId,options.requestId);
 if(!Array.isArray(options.approvedBucketIds)||
  !options.approvedBucketIds.includes(REVIEW_COMMUNITY_PHOTO_BUCKET))
  throw Error('Community photo bucket absent from exact deletion scope');
 const result=await verifyPrivateStorageByteAbsenceReview(options);
 return Object.freeze({...result,reviewOnly:true,accountDeletionReady:false,
  completePrivateStorage:false,uploadBarrierEnforced:false});
}
