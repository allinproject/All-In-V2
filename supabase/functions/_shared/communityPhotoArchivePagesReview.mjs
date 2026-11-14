/**
 * ALL-251 REVIEW ONLY: Community photo byte pages for the EXISTING paginated
 * encrypted account archive. No endpoint, export registry grant or release
 * completion. Caller owns a single pinned canonical DB snapshot and supplies
 * privileged owner-scoped Storage readers. This never creates a new archive.
 */
import {createHash} from 'node:crypto';
import {auditCommunityPhotoCoverageReview,REVIEW_COMMUNITY_PHOTO_BUCKET} from './communityPhotoPrivacyCoverageReview.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK=128*1024;
const MAX_TOTAL=64*1024*1024;
const COLLECTION='community.private_photos';
const sha=b=>createHash('sha256').update(b).digest('hex');

export async function createCommunityPhotoArchivePagesReview({
 ownerId,requestId,snapshotId,scoped,
}={}){
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'')||!UUID.test(snapshotId??'')||
  typeof scoped?.listCanonicalPostPhotos!=='function'||
  typeof scoped?.listOwnerStorageObjects!=='function'||
  typeof scoped?.listBucketCatalog!=='function'||
  typeof scoped?.downloadPrivatePhoto!=='function')
  throw Error('Trusted pinned Community photo archive dependencies required');
 const snapshot=await scoped.listCanonicalPostPhotos({ownerId,requestId});
 if(snapshot?.ownerId!==ownerId||snapshot.complete!==true||!Array.isArray(snapshot.rows))
  throw Error('Canonical Community photo snapshot missing');
 // The audit checks complete owner inventory and every source byte. Freeze
 // the bytes from THAT same restricted downloader to avoid mixed revisions.
 const frozen=new Map();
 let totalBytes=0;
 const downloadPrivatePhoto=async args=>{
  const bytes=await scoped.downloadPrivatePhoto(args);
  if(!(bytes instanceof Uint8Array)||!bytes.length)
   throw Error('Verified Community photo download unavailable');
  if(frozen.has(args.path))throw Error('Duplicate Community photo download');
  totalBytes+=bytes.length;
  if(totalBytes>MAX_TOTAL)throw Error('Community photo archive bound exceeded');
  frozen.set(args.path,Buffer.from(bytes));
  return bytes;
 };
 const proof=await auditCommunityPhotoCoverageReview({
  ownerId,requestId,listCanonicalPostPhotos:async()=>snapshot,
  listOwnerStorageObjects:scoped.listOwnerStorageObjects,
  listBucketCatalog:scoped.listBucketCatalog,downloadPrivatePhoto,
 });
 if(proof.exactOwnerCoverage!==true||proof.byteChecksumsVerified!==true||
  proof.completeUserExport!==false)
  throw Error('Community photo source verification incomplete');
 const records=[];
 for(const row of [...snapshot.rows].sort((a,b)=>a.object_path.localeCompare(b.object_path))){
  const bytes=frozen.get(row.object_path);
  if(!bytes||bytes.length!==row.byte_length||sha(bytes)!==row.sha256)
   throw Error('Frozen Community photo differs from canonical source');
  const parts=Math.ceil(bytes.length/CHUNK);
  for(let part=0;part<parts;part++){
   const payload=bytes.subarray(part*CHUNK,(part+1)*CHUNK);
   records.push(Object.freeze({
    bucket:REVIEW_COMMUNITY_PHOTO_BUCKET,path:row.object_path,
    kind:'community_photo',user_id:ownerId,
    postId:row.post_id,photoId:row.id,postVersion:row.post_version,
    contentType:'image/png',width:row.width,height:row.height,
    part,parts,fileSha256:row.sha256,fileLength:bytes.length,
    chunkSha256:sha(payload),dataBase64:payload.toString('base64'),
   }));
  }
 }
 return Object.freeze({
  sourceFileCount:snapshot.rows.length,totalChunkCount:records.length,
  reviewOnly:true,completeUserExport:false,
  async readPage({ownerId:o,requestId:r,collection,cursor,limit}={}){
   if(o!==ownerId||r!==requestId||collection!==COLLECTION||
    !(cursor===null||typeof cursor==='string'&&/^(0|[1-9][0-9]{0,5})$/.test(cursor))||
    !Number.isSafeInteger(limit)||limit<1)
    throw Error('Unauthorized Community photo archive page');
   const start=cursor===null?0:Number(cursor);
   if(start>records.length)throw Error('Community photo cursor out of range');
   // Cap at four to respect existing 1MiB encrypted page limit with base64.
   const end=Math.min(records.length,start+Math.min(limit,4));
   return {ownerId,requestId,collection,snapshotId,ownerVerified:true,
    rows:records.slice(start,end),done:end===records.length,
    nextCursor:end===records.length?null:String(end)};
  },
 });
}
