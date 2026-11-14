/**
 * ALL-251 / ALL-244 REVIEW ONLY — Community photo-to-post ownership boundary.
 * Server-only candidate. NOT an endpoint, bucket grant, or release approval.
 *
 * The canonical Community post is allin_private.v2_community_posts. Do not
 * introduce a second post owner. This candidate checks the authenticated owner
 * and exact post revision BEFORE invoking the staged photo sanitizer, then
 * fails closed because the canonical Storage writer has no approved Community
 * bucket, attachment ledger, export, or deletion checkpoint yet.
 *
 * Importing this module alone cannot activate uploads.
 */
import {processCommunityPhotoForReview} from '../../../apps/mobile-v2/src/features/community/communityPhotoProcessingGate.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied=(reason)=>Object.freeze({status:'denied',reason});

/**
 * Post reader must be the server-side canonical Community owner accessor,
 * returning exactly the row from allin_private.v2_community_posts. It must
 * not use a public feed response as proof of ownership.
 */
export async function reviewCommunityPhotoAttachment({
  bearer,postId,expectedPostVersion,photo,
  authenticateOwner,readCanonicalPost,decodeAndReencode,
  privateStorageWriter,
}={}){
 if(typeof bearer!=='string'||!/^Bearer\s+[^\s]+$/i.test(bearer)||
  !UUID.test(postId??'')||!Number.isSafeInteger(expectedPostVersion)||
  expectedPostVersion<1)return denied('invalid_request');
 if(typeof authenticateOwner!=='function'||typeof readCanonicalPost!=='function')
  return denied('canonical_owner_services_unavailable');

 let ownerId,post;
 try{
  // The authenticated identity is established server-side from a verified
  // live Auth session, never from client-supplied ownerId or object path.
  const session=await authenticateOwner(bearer.replace(/^Bearer\s+/i,''));
  if(session?.active!==true||session?.deletionPending===true||
   !UUID.test(session?.ownerId??''))return denied('owner_unavailable');
  ownerId=session.ownerId;
  post=await readCanonicalPost({postId});
 }catch{return denied('owner_verification_failed');}
 if(post?.id!==postId||post.owner_id!==ownerId||
  post.post_version!==expectedPostVersion||
  !['update','workout','food'].includes(post.kind)||
  !['public','followers','private'].includes(post.audience)||
  post.deleted_at!=null)return denied('post_owner_or_version_mismatch');

 // Check the processor only after owner authorization; unauthorized users
 // must not spend decode resources or learn whether photo content is valid.
 const sanitized=await processCommunityPhotoForReview(photo,{decodeAndReencode});
 if(!sanitized.ok)return denied('photo_processing_unavailable_or_rejected');

 // IMPORTANT: the existing privileged writer currently allowlists only
 // workout objects and account exports. We must NOT weaken that allowlist,
 // invent a Community bucket, mint a signed upload URL, or write bytes before
 // the canonical media ledger + owner/deletion/export gates are accepted.
 // Even an injected writer cannot bypass this constant release barrier.
 void privateStorageWriter;
 void sanitized;
 return denied('community_photo_storage_not_approved');
}
