/**
 * ALL-251 disposable in-memory multi-domain encrypted archive rehearsal.
 * Existing workout and Community readers, SAME export manifest/KMS key and
 * verified JSONL stream. TEST-ONLY inventory injection; no production grant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createApprovedPrivateMediaPageReader} from './trainingExportPrivateMediaPages.mjs';
import {createCommunityPhotoArchivePagesReview} from './communityPhotoArchivePagesReview.mjs';
import {verifyCommunityPhotoRecoveryReview} from './communityPhotoArchiveRecoveryReview.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from './trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from './trainingExportDownloadVerifier.mjs';

const owner='a1111111-a111-4111-8111-a11111111111';
const foreign='b2222222-b222-4222-8222-b22222222222';
const requestId='c3333333-c333-4333-8333-c33333333333';
const snapshotId='d4444444-d444-4444-8444-d44444444444';
const post='e5555555-e555-4555-8555-e55555555555';
const photo='f6666666-f666-4666-8666-f66666666666';
const workoutBucket='v2-private-workout-objects';
const communityBucket='v2-private-community-photos';
const collections=['private_media','community.private_photos'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const seriesPath=owner+'/'+ 'a'.repeat(64)+'/series.fit';
const routePath=owner+'/'+ 'b'.repeat(64)+'/route.geojson';
const photoPath=owner+'/posts/'+post+'/'+photo+'.png';
const fixtureBytes=new Map([
 [seriesPath,Buffer.alloc(270000,0x31)],
 [routePath,Buffer.alloc(145000,0x32)],
 [photoPath,Buffer.alloc(300000,0x33)],
]);
const photoRow={id:photo,post_id:post,owner_id:owner,post_owner_id:owner,
 post_version:1,bucket_id:communityBucket,object_path:photoPath,
 content_type:'image/png',width:300,height:300,byte_length:fixtureBytes.get(photoPath).length,
 sha256:sha(fixtureBytes.get(photoPath)),lifecycle:'verified',verified_at:'2026-11-14T20:00:00Z'};
const photoSnapshot={ownerId:owner,complete:true,rows:[photoRow]};
const evidence={ownerId:owner,requestId,
 series:[{user_id:owner,object_path:seriesPath,
  checksum_sha256:sha(fixtureBytes.get(seriesPath)),state:'ready'}],
 routes:[{user_id:owner,object_path:routePath,
  checksum_sha256:sha(fixtureBytes.get(routePath)),state:'ready',privacy_state:'private'}],
};
async function fixture({
 photoRows=photoSnapshot.rows,photoObjects=[photoPath],workoutObjects=[seriesPath,routePath],
 corruptPhoto=false,corruptTraining=false,authOwner=owner,inventoryComplete=true,
}={}){
 const workout=await createApprovedPrivateMediaPageReader({
  ownerId:owner,requestId,snapshotId,
  scoped:{
   listCanonicalMediaReferences:async()=>evidence,
   listBucketCatalog:async()=>[{id:workoutBucket,public:false}],
   listOwnerStorageObjects:async()=>({ownerId:owner,bucketId:workoutBucket,
    exhaustive:true,totalCount:workoutObjects.length,paths:workoutObjects}),
  },
  downloadPrivateObject:async({ownerId:found,path})=>{
   assert.equal(found,owner);
   return corruptTraining&&path===routePath?Buffer.from('altered'):fixtureBytes.get(path);
  },
 });
 const photos=await createCommunityPhotoArchivePagesReview({
  ownerId:owner,requestId,snapshotId,
  scoped:{
   listCanonicalPostPhotos:async()=>({ownerId:owner,complete:true,rows:photoRows}),
   listBucketCatalog:async()=>[{id:communityBucket,public:false}],
   listOwnerStorageObjects:async()=>({ownerId:owner,bucketId:communityBucket,
    exhaustive:true,totalCount:photoObjects.length,paths:photoObjects}),
   downloadPrivatePhoto:async()=>corruptPhoto?Buffer.from('changed'):fixtureBytes.get(photoPath),
  },
 });
 const key=randomBytes(32),sealedPages=new Map();let manifest=null,allowed=true;
 const readers={'private_media':workout.readPage,'community.private_photos':photos.readPage};
 const services={
  authorizeExport:async()=>({ownerId:authOwner,activeSession:allowed,exportPermitted:allowed}),
  // This is the ONE synthetic test-only inventory for BOTH media domains.
  // The operational canonical export inventory remains unmodified and OFF.
  getCanonicalInventory:async()=>({ownerId:owner,requestId,snapshotId,
   complete:inventoryComplete,collections}),
  readPage:args=>readers[args.collection](args),
  resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId,collection,index,sealed})=>{
   sealedPages.set(collection+':'+index,sealed);
   return {ownerId,requestId,collection,index,stored:true};
  },
  commitPrivateManifest:async({ownerId,requestId,manifest:written})=>{
   manifest=written;return {ownerId,requestId,committed:true};
  },
  readPrivateManifest:async()=>manifest,
  readPrivatePage:async({collection,index})=>sealedPages.get(collection+':'+index),
  purgePrivateRequest:async()=>{sealedPages.clear();manifest=null;return true;},
 };
 return {services,workout,photos,photoSnapshot,sealedPages,getManifest:()=>manifest,
  revoke:()=>{allowed=false;}};
}
function reassemble(records,paths){
 const result=new Map();
 for(const path of paths){
  const parts=records.filter(row=>row.path===path);
  assert(parts.length>0,'Missing private media file');
  const count=parts[0].parts;
  assert.equal(parts.length,count);
  assert.deepEqual(parts.map(p=>p.part).sort((a,b)=>a-b),
   Array.from({length:count},(_,i)=>i));
  const clear=Buffer.concat(parts.sort((a,b)=>a.part-b.part).map(row=>{
   const chunk=Buffer.from(row.dataBase64,'base64');
   assert.equal(sha(chunk),row.chunkSha256);
   assert.equal(row.fileSha256,sha(fixtureBytes.get(path)));
   assert.equal(row.fileLength,fixtureBytes.get(path).length);
   return chunk;
  }));
  assert.equal(sha(clear),sha(fixtureBytes.get(path)));
  result.set(path,clear);
 }
 return result;
}
test('one encrypted manifest and download recovers workout series, route and Community photo bytes',async()=>{
 const f=await fixture();
 const staged=await stageLargeAccountExport({requestId,collections,services:f.services});
 assert.equal(staged.encrypted,true);
 assert.equal(staged.recordCount,f.workout.totalChunkCount+f.photos.totalChunkCount);
 const manifest=f.getManifest();
 assert.deepEqual(manifest.collections,collections);
 assert(manifest.pages.some(p=>p.collection==='private_media'));
 assert(manifest.pages.some(p=>p.collection==='community.private_photos'));
 assert(!JSON.stringify(manifest).includes(fixtureBytes.get(photoPath).toString('base64').slice(0,100)));
 const response=await createLargeAccountDownloadResponse({requestId,collections,services:f.services});
 const copy=response.clone();
 const download=await verifyAccountExportDownload({
  stream:copy.body,expectedOwnerId:owner,expectedCollections:collections,
 });
 assert.equal(download.verified,true);
 const recovery=await verifyCommunityPhotoRecoveryReview({
  response:response.clone(),ownerId:owner,requestId,collections,
  canonicalSnapshot:f.photoSnapshot,
 });
 assert.equal(recovery.fileByteRecoveryVerified,true);
 assert.deepEqual(Buffer.from(recovery.restored.get(photoPath)),fixtureBytes.get(photoPath));
 assert.equal(recovery.completeUserExport,false,'review-only recovery cannot approve operational export');
 const lines=(await response.text()).trimEnd().split('\n').map(JSON.parse);
 const workout=lines.slice(1,-1).filter(x=>x.collection==='private_media').map(x=>x.record);
 const restored=reassemble(workout,[seriesPath,routePath]);
 for(const [path,bytes] of restored)assert.deepEqual(bytes,fixtureBytes.get(path));
 f.revoke();
 await assert.rejects(createLargeAccountDownloadResponse({
  requestId,collections,services:f.services,
 }),/revoked/);
});
test('unverified or orphan photo and mismatched workout Storage block the entire combined archive',async()=>{
 for(const options of [
  {photoRows:[{...photoRow,lifecycle:'pending',verified_at:null}]},
  {photoRows:[{...photoRow,owner_id:foreign}]},
  {photoObjects:[photoPath,owner+'/rogue.png']},
  {photoObjects:[]},
  {workoutObjects:[seriesPath]},
  {corruptPhoto:true},
  {corruptTraining:true},
 ]){
  await assert.rejects(fixture(options),
   /Community|Unreferenced|missing|checksum|incomplete|Invalid|changed|Canonical media reference/);
 }
});
test('synthetic combined inventory cannot authorize incomplete or foreign owner export',async()=>{
 const invalid=await fixture({inventoryComplete:false});
 await assert.rejects(stageLargeAccountExport({
  requestId,collections,services:invalid.services,
 }),/incomplete/);
 const other=await fixture({authOwner:foreign});
 await assert.rejects(stageLargeAccountExport({
  requestId,collections,services:other.services,
 }),/incomplete/);
});
