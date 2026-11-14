import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createCommunityPhotoArchivePagesReview} from './communityPhotoArchivePagesReview.mjs';
import {verifyCommunityPhotoRecoveryReview} from './communityPhotoArchiveRecoveryReview.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from './trainingExportLargeArchive.mjs';

const a='a1111111-a111-4111-8111-a11111111111';
const b='b2222222-b222-4222-8222-b22222222222';
const request='c3333333-c333-4333-8333-c33333333333';
const snap='d4444444-d444-4444-8444-d44444444444';
const post='e5555555-e555-4555-8555-e55555555555';
const photo='f6666666-f666-4666-8666-f66666666666';
const bucket='v2-private-community-photos';
const path=a+'/posts/'+post+'/'+photo+'.png';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=Buffer.alloc(275000,0x2f);
const row={id:photo,post_id:post,owner_id:a,post_owner_id:a,
 post_version:1,bucket_id:bucket,object_path:path,content_type:'image/png',
 width:300,height:300,byte_length:bytes.length,sha256:sha(bytes),
 lifecycle:'verified',verified_at:'2026-11-14T20:00:00Z'};
const snapshot={ownerId:a,complete:true,rows:[row]};

async function archive({transform,collections=['community.private_photos'],authOwner=a,
 inventoryOwner=a}={}){
 const scoped={
  listCanonicalPostPhotos:async()=>snapshot,
  listBucketCatalog:async()=>[{id:bucket,public:false}],
  listOwnerStorageObjects:async()=>({ownerId:a,bucketId:bucket,exhaustive:true,
   totalCount:1,paths:[path]}),
  downloadPrivatePhoto:async()=>bytes,
 };
 const media=await createCommunityPhotoArchivePagesReview({
  ownerId:a,requestId:request,snapshotId:snap,scoped,
 });
 const key=randomBytes(32),stored=new Map();
 let manifest;
 const services={
  authorizeExport:async()=>({ownerId:authOwner,activeSession:true,exportPermitted:true}),
  // Explicit synthetic-only inventory, never an operational source approval.
  getCanonicalInventory:async()=>({ownerId:inventoryOwner,requestId:request,
   snapshotId:snap,collections,complete:true}),
  readPage:async args=>{
   const original=await media.readPage(args);
   const changed=transform?transform(original):original;
   return changed;
  },
  resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId,collection,index,sealed})=>{
   stored.set(collection+':'+index,sealed);
   return {ownerId,requestId,collection,index,stored:true};},
  commitPrivateManifest:async({ownerId,requestId,manifest:m})=>{
   manifest=m;return {ownerId,requestId,committed:true};},
  readPrivateManifest:async()=>manifest,
  readPrivatePage:async({collection,index})=>stored.get(collection+':'+index),
  purgePrivateRequest:async()=>{stored.clear();manifest=null;return true;},
 };
 await stageLargeAccountExport({requestId,collections,services});
 return createLargeAccountDownloadResponse({requestId,collections,services});
}

test('existing encrypted archive restores every Community photo byte and refuses foreign owner',async()=>{
 const response=await archive();
 const result=await verifyCommunityPhotoRecoveryReview({
  response,ownerId:a,requestId:request,collections:['community.private_photos'],
  canonicalSnapshot:snapshot,
 });
 assert.equal(result.reviewOnly,true);
 assert.equal(result.fileByteRecoveryVerified,true);
 assert.equal(result.completeUserExport,false);
 assert.equal(result.accountDeletionReady,false);
 assert.equal(result.verifiedPhotoCount,1);
 assert.deepEqual(Buffer.from(result.restored.get(path)),bytes);
 await assert.rejects(verifyCommunityPhotoRecoveryReview({
  response:await archive(),ownerId:b,requestId:request,
  collections:['community.private_photos'],canonicalSnapshot:snapshot,
 }));
});
test('even a valid encrypted archive footer does not excuse missing or duplicate photo chunks',async()=>{
 for(const transform of [
  page=>({...page,rows:page.rows.slice(1)}),
  page=>({...page,rows:[...page.rows,page.rows[0]]}),
  page=>({...page,rows:page.rows.map((r,i)=>({...r,part:i===0?0:0}))}),
 ]){
  await assert.rejects(verifyCommunityPhotoRecoveryReview({
   response:await archive({transform}),ownerId:a,requestId:request,
   collections:['community.private_photos'],canonicalSnapshot:snapshot,
  }),/photo archive recovery evidence incomplete/i);
 }
});
test('valid archive footer still refuses changed photo metadata, checksum and byte length',async()=>{
 for(const mutate of [
  r=>({...r,photoId:b}),
  r=>({...r,postId:b}),
  r=>({...r,fileLength:r.fileLength+1}),
  r=>({...r,fileSha256:'0'.repeat(64)}),
  r=>({...r,chunkSha256:'0'.repeat(64)}),
  r=>({...r,kind:'route'}),
  r=>({...r,bucket:'v2-private-workout-objects'}),
  r=>({...r,user_id:b}),
 ]){
  await assert.rejects(verifyCommunityPhotoRecoveryReview({
   response:await archive({transform:page=>({...page,
    rows:page.rows.map((r,i)=>i===0?mutate(r):r)})}),
   ownerId:a,requestId:request,collections:['community.private_photos'],
   canonicalSnapshot:snapshot,
  }));
 }
});
test('missing canonical records or unverified lifecycle cannot be replaced by self-described archive bytes',async()=>{
 for(const source of [
  {ownerId:a,complete:true,rows:[]},
  {ownerId:a,complete:true,rows:[{...row,lifecycle:'pending',verified_at:null}]},
  {ownerId:a,complete:false,rows:[row]},
  {ownerId:b,complete:true,rows:[row]},
 ]){
  await assert.rejects(verifyCommunityPhotoRecoveryReview({
   response:await archive(),ownerId:a,requestId:request,
   collections:['community.private_photos'],canonicalSnapshot:source,
  }));
 }
});
test('archive cannot pass a second-collection claim when it was not staged',async()=>{
 await assert.rejects(verifyCommunityPhotoRecoveryReview({
  response:await archive(),ownerId:a,requestId:request,
  collections:['private_media','community.private_photos'],
  canonicalSnapshot:snapshot,
 }));
});
