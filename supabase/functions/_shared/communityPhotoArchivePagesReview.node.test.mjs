import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createCommunityPhotoArchivePagesReview} from './communityPhotoArchivePagesReview.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from './trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from './trainingExportDownloadVerifier.mjs';

const owner='a1111111-a111-4111-8111-a11111111111';
const other='b2222222-b222-4222-8222-b22222222222';
const requestId='c3333333-c333-4333-8333-c33333333333';
const snapshotId='d4444444-d444-4444-8444-d44444444444';
const post='e5555555-e555-4555-8555-e55555555555';
const photo='f6666666-f666-4666-8666-f66666666666';
const bucket='v2-private-community-photos';
const path=owner+'/posts/'+post+'/'+photo+'.png';
const sha=b=>createHash('sha256').update(b).digest('hex');
const content=Buffer.alloc(260000,0x31);
const baseRow={id:photo,post_id:post,owner_id:owner,post_owner_id:owner,
 post_version:1,bucket_id:bucket,object_path:path,content_type:'image/png',
 width:320,height:320,byte_length:content.length,sha256:sha(content),
 lifecycle:'verified',verified_at:'2026-11-14T20:00:00Z'};
function fixture(config={}){
 const calls=[];
 const scoped={
  listCanonicalPostPhotos:async()=>{calls.push('rows');return {
   ownerId:owner,complete:config.complete??true,rows:config.rows??[baseRow]};},
  listBucketCatalog:async()=>[{id:bucket,public:false}],
  listOwnerStorageObjects:async()=>({ownerId:owner,bucketId:bucket,
   exhaustive:true,totalCount:config.paths?.length??1,paths:config.paths??[path]}),
  downloadPrivatePhoto:async args=>{calls.push('read');assert.equal(args.ownerId,owner);
   return config.bytes??content;},
 };
 return {scoped,calls};
}
test('Community photo is exported through existing AES-GCM archive and restored byte-for-byte',async()=>{
 const f=fixture();
 const media=await createCommunityPhotoArchivePagesReview({
  ownerId:owner,requestId,snapshotId,scoped:f.scoped,
 });
 assert.equal(media.reviewOnly,true);
 assert.equal(media.completeUserExport,false);
 assert.equal(media.sourceFileCount,1);
 assert.equal(media.totalChunkCount,2);
 assert.deepEqual(f.calls,['rows','read']);
 const collections=['community.private_photos'],key=randomBytes(32);
 const pages=new Map();let manifest;
 const services={
  authorizeExport:async()=>({ownerId:owner,activeSession:true,exportPermitted:true}),
  // TEST-ONLY synthetic inventory registration; operational inventory remains
  // unchanged and continues to refuse Community media.
  getCanonicalInventory:async()=>({ownerId:owner,requestId,snapshotId,collections,complete:true}),
  readPage:media.readPage,
  resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId,collection,index,sealed})=>{
   pages.set(index,sealed);return {ownerId,requestId,collection,index,stored:true};},
  commitPrivateManifest:async({ownerId,requestId,manifest:m})=>{
   manifest=m;return {ownerId,requestId,committed:true};},
  readPrivateManifest:async()=>manifest,
  readPrivatePage:async({index})=>pages.get(index),
  purgePrivateRequest:async()=>{pages.clear();manifest=null;return true;},
 };
 const receipt=await stageLargeAccountExport({requestId,collections,services});
 assert.equal(receipt.recordCount,2);
 assert.equal(receipt.encrypted,true);
 assert.equal(manifest.completeUserExport,true); // fixture-only synthetic inventory
 assert(!JSON.stringify(manifest).includes(content.toString('base64').slice(0,60)));
 const response=await createLargeAccountDownloadResponse({requestId,collections,services});
 const raw=await response.clone().text();
 const proof=await verifyAccountExportDownload({
  stream:response.body,expectedOwnerId:owner,expectedCollections:collections,
 });
 assert.equal(proof.verified,true);
 const records=raw.trimEnd().split('\n').slice(1,-1).map(s=>JSON.parse(s).record);
 assert.equal(records.length,2);
 assert(records.every(x=>x.user_id===owner&&x.path===path&&x.kind==='community_photo'));
 const reconstructed=Buffer.concat(records.sort((a,b)=>a.part-b.part).map(x=>{
  const b=Buffer.from(x.dataBase64,'base64');
  assert.equal(sha(b),x.chunkSha256);return b;
 }));
 assert.equal(sha(reconstructed),baseRow.sha256);
 assert.deepEqual(reconstructed,content);
 await assert.rejects(media.readPage({ownerId:other,requestId,collection:collections[0],
  cursor:null,limit:4}),/Unauthorized/);
});
test('missing, foreign, unverified, oversized or altered photo source blocks encrypted staging',async()=>{
 for(const change of [
  {rows:[{...baseRow,owner_id:other}]},
  {rows:[{...baseRow,lifecycle:'pending',verified_at:null}]},
  {rows:[{...baseRow,post_owner_id:other}]},
  {rows:[{...baseRow,byte_length:content.length+1}]},
  {paths:[]},{paths:[path,owner+'/rogue.png']},
  {bytes:Buffer.from('tampered')},{complete:false},
 ]){
  await assert.rejects(createCommunityPhotoArchivePagesReview({
   ownerId:owner,requestId,snapshotId,scoped:fixture(change).scoped,
  }));
 }
});
test('page reader cannot be used for unregistered collections or foreign requests',async()=>{
 const media=await createCommunityPhotoArchivePagesReview({
  ownerId:owner,requestId,snapshotId,scoped:fixture().scoped,
 });
 for(const args of [
  {ownerId:other,requestId,collection:'community.private_photos',cursor:null,limit:4},
  {ownerId:owner,requestId:other,collection:'community.private_photos',cursor:null,limit:4},
  {ownerId:owner,requestId,collection:'private_media',cursor:null,limit:4},
  {ownerId:owner,requestId,collection:'community.private_photos',cursor:'..',limit:4},
 ])await assert.rejects(media.readPage(args),/Unauthorized/);
});
