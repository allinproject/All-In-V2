import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createApprovedPrivateMediaPageReader} from './trainingExportPrivateMediaPages.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from './trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from './trainingExportDownloadVerifier.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const snapshotId='44444444-4444-4444-8444-444444444444';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(opts={}){
 const series=Buffer.alloc(520000,0x4a),route=Buffer.alloc(190000,0x5b);
 const a=owner+'/'+ 'a'.repeat(64)+'/series.fit';
 const b=owner+'/'+ 'b'.repeat(64)+'/route.geojson';
 const refs={ownerId:owner,requestId,series:[{user_id:owner,object_path:a,checksum_sha256:hash(series)}],
  routes:[{user_id:owner,object_path:b,checksum_sha256:hash(route)}]};
 const paths=[a,b],files=new Map([[a,series],[b,route]]),calls=[];
 const scoped={
  listBucketCatalog:async()=>[{id:'v2-private-workout-objects',public:false}],
  listOwnerStorageObjects:async({ownerId,bucketId})=>({ownerId,bucketId,
    exhaustive:!opts.incomplete,totalCount:opts.orphan?3:paths.length,
    paths:opts.orphan?[...paths,owner+'/unreferenced.jpg']:paths}),
  listCanonicalMediaReferences:async()=>refs,
 };
 const downloadPrivateObject=async({ownerId,path,kind})=>{
  calls.push({ownerId,path,kind});
  if(ownerId!==owner||!files.has(path)||kind!==(path===a?'series':'route'))
   throw Error('Unapproved private evidence download');
  return opts.corrupt&&path===b?Buffer.from('tampered'):files.get(path);
 };
 return {scoped,refs,files,paths,calls,downloadPrivateObject,series,route};
}
test('approved series and routes are encrypted in independently verified bounded media pages',async()=>{
 const f=fixture();
 const media=await createApprovedPrivateMediaPageReader({
  ownerId:owner,requestId,snapshotId,scoped:f.scoped,
  downloadPrivateObject:f.downloadPrivateObject,
 });
 assert.equal(media.sourceFileCount,2);
 assert(media.totalChunkCount>3);
 const first=await media.readPage({ownerId:owner,requestId,collection:'private_media',cursor:null,limit:25});
 assert.equal(first.rows.length,4);
 assert.equal(first.done,false);
 assert.equal(first.rows[0].user_id,owner);
 assert.equal(first.rows[0].part,0);
 assert.equal(first.rows[0].kind,'series');
 assert.deepEqual(Buffer.from(first.rows[0].dataBase64,'base64'),f.series.subarray(0,128*1024));
 assert(f.calls.some(x=>x.kind==='series')&&f.calls.some(x=>x.kind==='route'));
 const key=randomBytes(32),storage=new Map();let manifest,allowed=true;
 const collections=['private_media'],services={
  authorizeExport:async()=>({ownerId:owner,activeSession:allowed,exportPermitted:allowed}),
  getCanonicalInventory:async()=>({ownerId:owner,requestId,snapshotId,complete:true,collections}),
  readPage:media.readPage,
  resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId:rid,collection,index,sealed})=>{
   storage.set(index,sealed);return {ownerId,requestId:rid,collection,index,stored:true};},
  commitPrivateManifest:async({ownerId,requestId:rid,manifest:m})=>{
   manifest=m;return {ownerId,requestId:rid,committed:true};},
  readPrivateManifest:async()=>manifest,
  readPrivatePage:async({index})=>storage.get(index),
  purgePrivateRequest:async()=>{storage.clear();manifest=null;return true;},
 };
 const receipt=await stageLargeAccountExport({requestId,collections,services});
 assert.equal(receipt.recordCount,media.totalChunkCount);
 assert.equal(receipt.encrypted,true);
 assert.equal(receipt.pageCount,Math.ceil(media.totalChunkCount/4));
 assert(!JSON.stringify(manifest).includes(f.series.toString('base64').slice(0,70)));
 const response=await createLargeAccountDownloadResponse({requestId,collections,services});
 const raw=await response.clone().text();
 const verified=await verifyAccountExportDownload({
  stream:response.body,expectedOwnerId:owner,expectedCollections:collections,
 });
 assert.equal(verified.verified,true);
 assert.equal(verified.recordCount,media.totalChunkCount);
 const records=raw.trimEnd().split('\n').slice(1,-1).map(line=>JSON.parse(line).record);
 const reconstructed=new Map();
 for(const row of records){
  assert.equal(hash(Buffer.from(row.dataBase64,'base64')),row.chunkSha256);
  if(!reconstructed.has(row.path))reconstructed.set(row.path,[]);
  reconstructed.get(row.path).push(row);
 }
 for(const [path,bytes] of f.files){
  const chunks=reconstructed.get(path).sort((x,y)=>x.part-y.part);
  assert.equal(chunks.length,chunks[0].parts);
  assert.equal(chunks[0].fileSha256,hash(bytes));
  assert.deepEqual(Buffer.concat(chunks.map(x=>Buffer.from(x.dataBase64,'base64'))),bytes);
 }
 allowed=false;
 await assert.rejects(createLargeAccountDownloadResponse({requestId,collections,services}),/revoked/);
});
test('unreferenced object, altered bytes and incomplete Storage catalog fail before any media page is exported',async()=>{
 for(const options of [{orphan:true},{corrupt:true},{incomplete:true}]){
  const f=fixture(options);
  await assert.rejects(createApprovedPrivateMediaPageReader({
   ownerId:owner,requestId,snapshotId,scoped:f.scoped,
   downloadPrivateObject:f.downloadPrivateObject,
  }),/Unreferenced|checksum|incomplete/);
 }
});
test('another owner cannot use already pinned media reader or traverse source identities',async()=>{
 const f=fixture();
 const media=await createApprovedPrivateMediaPageReader({
  ownerId:owner,requestId,snapshotId,scoped:f.scoped,
  downloadPrivateObject:f.downloadPrivateObject,
 });
 for(const args of [
  {ownerId:other,requestId,collection:'private_media',cursor:null,limit:4},
  {ownerId:owner,requestId,collection:'private_media',cursor:'..',limit:4},
  {ownerId:owner,requestId,collection:'unapproved_bucket',cursor:null,limit:4},
 ])
  await assert.rejects(media.readPage(args),/Unapproved/);
});
