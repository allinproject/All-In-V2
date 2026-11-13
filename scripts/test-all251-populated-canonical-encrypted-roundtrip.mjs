/**
 * ALL-251 ISOLATED ACCEPTANCE ONLY. Archives the 50 exact reviewed canonical
 * PG RPC owner collections emitted by the populated rollback-only fixture.
 * Existing canonical SQL declares complete:false, and must stay that way.
 * ONLY THIS TEST creates a synthetic approved inventory for exercising the
 * encrypted archive/download transport; never import this into a worker.
 *
 * No production/hosted DB, no real KMS, no live endpoint, no deletion.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {stageLargeAccountExport,createLargeAccountDownloadResponse}
 from '../supabase/functions/_shared/trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload}
 from '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';
import {createApprovedPrivateMediaPageReader}
 from '../supabase/functions/_shared/trainingExportPrivateMediaPages.mjs';
if(!['1','true'].includes(process.env.CI??''))
 throw Error('Representative export archive replay requires isolated CI');
if(process.argv.length!==3||!process.argv[2]?.includes('all251-full-domain-capture.jsonl'))
 throw Error('Exact isolated canonical SQL capture file required');
const lines=readFileSync(process.argv[2],'utf8').trim().split('\n').map(s=>JSON.parse(s));
assert(lines.length>53 && lines.length<600);
assert.equal(lines[0]?.kind,'inventory');
const original=lines[0].payload;
const owner='91111111-9111-4111-8111-911111111111';
const other='92222222-9222-4222-8222-922222222222';
const requestId='95555555-9555-4555-8555-955555555555';
const sessionId='93333333-9333-4333-8333-933333333333';
assert.equal(original.ownerId,owner);
assert.equal(original.requestId,requestId);
assert.equal(original.complete,false,'Canonical exporter must remain disabled');
assert.equal(original.paginationReady,true);
assert(Array.isArray(original.collections));
assert.equal(original.collections.length,50);
assert.equal(new Set(original.collections).size,50);
// One additional private-media collection is approved ONLY by this synthetic
// test after strict source-byte auditing, never by the canonical SQL release.
const collections=[...original.collections,'private_media'];
const snapshotId=original.snapshotId;
assert.match(snapshotId,/^[0-9a-f-]{36}$/i);
const sourcePages=new Map(collections.map(c=>[c,[]]));
let sourceRows=0;
for(const {kind,payload} of lines.slice(1)){
 assert.equal(kind,'page');
 assert.equal(payload.ownerId,owner);
 assert.equal(payload.requestId,requestId);
 assert.equal(payload.snapshotId,snapshotId);
 assert.equal(payload.ownerVerified,true);
 assert.equal(payload.completeUserExport,false);
 assert(sourcePages.has(payload.collection),'Unreviewed canonical data source in SQL capture');
 assert(Array.isArray(payload.rows) && payload.rows.length<=25);
 assert(payload.rows.every(row=>row && typeof row==='object' && !Array.isArray(row)));
 assert(payload.rows.every(row=>!Object.hasOwn(row,'user_id')||row.user_id===owner));
 sourcePages.get(payload.collection).push(payload);
 sourceRows+=payload.rows.length;
}
assert(sourceRows>90,'Representative owner source rows unexpectedly sparse');
assert.equal(sourcePages.get('public.v2_coach_messages').flatMap(p=>p.rows).length,53);
assert.equal(sourcePages.get('public.v2_completed_activities').flatMap(p=>p.rows).length,32);
for(const name of [
 'public.v2_training_plans','public.v2_event_participations',
 'public.v2_goal_event_edition_links','billing.checkout_attempts',
 'billing.purchases','billing.verified_events',
 'community.outgoing_blocks','community.my_action_receipts'
])assert(sourcePages.has(name),'Missing required canonical reviewed domain: '+name);
for(const [collection,pages] of sourcePages){
 assert(pages.length>0,'Canonical source never inventoried: '+collection);
 assert.equal(pages.at(-1).done,true,'Missing final page: '+collection);
 const seen=new Set();
 for(let i=0;i<pages.length;i++){
  const p=pages[i];
  if(i===0)assert(pages[0].collection===collection);
  if(i<pages.length-1){
   assert.equal(p.done,false);
   assert(typeof p.nextCursor==='string'&&p.nextCursor.length>0);
   assert(!seen.has(p.nextCursor),'Repeated SQL cursor');
   seen.add(p.nextCursor);
  }else assert.equal(p.nextCursor,null);
 }
}
// Explicit synthetic media side of the SAME encrypted manifest: the SQL
// archive is still a complete=false 50-source review, and media is not
// registered or permitted in the production source inventory.
const originalMedia=new Map([
 [owner+'/'+'a'.repeat(64)+'/series.fit',randomBytes(260000)],
 [owner+'/'+'b'.repeat(64)+'/route.geojson',randomBytes(145000)],
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const mediaRefs={
 ownerId:owner,requestId,
 series:[{user_id:owner,object_path:[...originalMedia.keys()][0],
  checksum_sha256:hash([...originalMedia.values()][0]),state:'ready'}],
 routes:[{user_id:owner,object_path:[...originalMedia.keys()][1],
  checksum_sha256:hash([...originalMedia.values()][1]),state:'ready',
  privacy_state:'private'}],
};
const mediaScoped={
 listCanonicalMediaReferences:async()=>mediaRefs,
 listBucketCatalog:async()=>[{id:'v2-private-workout-objects',public:false}],
 listOwnerStorageObjects:async()=>({
  ownerId,requestId,bucketId:'v2-private-workout-objects',
  exhaustive:true,totalCount:originalMedia.size,paths:[...originalMedia.keys()]
 }),
};
const downloadPrivateObject=async({ownerId,path,kind})=>{
 assert.equal(ownerId,owner);
 assert.equal(kind,path.endsWith('series.fit')?'series':'route');
 const bytes=originalMedia.get(path);
 assert(bytes,'Another owner or unreferenced private object requested');
 return bytes;
};
// The existing audited media reader refuses orphan references, unknown
// buckets, non-private routes, altered bytes, and cross-owner paths.
const mediaReader=await createApprovedPrivateMediaPageReader({
 ownerId:owner,requestId,snapshotId,scoped:mediaScoped,downloadPrivateObject
});
const mediaPages=[];let mediaCursor=null;
do{
 const page=await mediaReader.readPage({ownerId:owner,requestId,
  collection:'private_media',cursor:mediaCursor,limit:25});
 assert(page.rows.length<=4);
 mediaPages.push(page);
 if(page.done)break;
 assert(page.nextCursor!==mediaCursor);
 mediaCursor=page.nextCursor;
}while(mediaPages.length<20);
assert(mediaPages.at(-1)?.done);
sourcePages.set('private_media',mediaPages);
const mediaRows=mediaPages.flatMap(page=>page.rows);
assert(mediaRows.length>=4);
sourceRows+=mediaRows.length;
const originalOwnerRows=collections.flatMap(c=>sourcePages.get(c).flatMap(p=>p.rows.map(record=>({collection:c,record}))));
assert.equal(originalOwnerRows.length,sourceRows);
const corpus=JSON.stringify(originalOwnerRows);
for(const secret of ['Owner B private Coach','B private race note','private-checkout-B','private-subscription-B'])
 assert(!corpus.includes(secret),"Foreign owner's private data entered canonical capture");
for(const internal of ['payload_sha256','expected_version','result_version'])
 assert(!originalOwnerRows.some(({collection,record})=>collection==='community.my_action_receipts'&&
  Object.hasOwn(record,internal)), 'Community internal CAS state leaked');
const key=randomBytes(32),folder=mkdtempSync(join(tmpdir(),'all251-populated-archive-'));
let granted=true,checkCount=0,manifest=null;
const p=(c,i)=>join(folder,createHash('sha256').update(c).digest('hex')+'-'+i+'.json');
const manifestPath=join(folder,'manifest.json');
let archivedCount=0;
function baseServices(){
 return {
  authorizeExport:async(rid)=>{
   assert.equal(rid,requestId);checkCount++;
   return {ownerId:owner,sessionId,activeSession:granted,exportPermitted:granted};
  },
  getCanonicalInventory:async({ownerId,requestId:rid})=>{
   assert.equal(ownerId,owner);assert.equal(rid,requestId);
   // RELEASE OVERRIDE IS ONLY IN THE DISPOSABLE TEST HARNESS.
   // SQL canonical inventory complete:false is never modified.
   return {ownerId:owner,requestId:rid,snapshotId,collections,complete:true};
  },
  readPage:async({ownerId,requestId:rid,collection,cursor,limit})=>{
   assert.equal(ownerId,owner);assert.equal(rid,requestId);
   assert(Number.isInteger(limit)&&limit>=25&&limit<=200); // Archive requests 200; canonical SQL produced <=25
   const pages=sourcePages.get(collection);
   assert(pages,'Unknown canonical source '+collection);
   const i=cursor===null?0:pages.findIndex((_,j)=>j>0&&pages[j-1].nextCursor===cursor);
   assert(i>=0&&i<pages.length,'Unapproved page cursor');
   const row=pages[i];
   return {...row,ownerId:owner,requestId:rid,collection,
    snapshotId,ownerVerified:true};
  },
  resolveEncryptionKey:async({ownerId,requestId:rid})=>{
   assert.equal(ownerId,owner);assert.equal(rid,requestId);return key;
  },
  writePrivatePage:async({ownerId,requestId:rid,collection,index,sealed})=>{
   assert.equal(ownerId,owner);assert.equal(rid,requestId);
   assert(!JSON.stringify(sealed).includes('Owner A Coach page'),
     'Encrypted page stored plaintext');
   writeFileSync(p(collection,index),JSON.stringify(sealed),{mode:0o600});
   archivedCount++;return {ownerId,requestId:rid,collection,index,stored:true};
  },
  commitPrivateManifest:async({ownerId,requestId:rid,manifest:m})=>{
   assert.equal(ownerId,owner);assert.equal(rid,requestId);
   writeFileSync(manifestPath,JSON.stringify(m),{mode:0o600});
   manifest=m;return {ownerId,requestId:rid,committed:true};
  },
  readPrivateManifest:async()=>JSON.parse(readFileSync(manifestPath,'utf8')),
  readPrivatePage:async({collection,index})=>JSON.parse(readFileSync(p(collection,index),'utf8')),
  purgePrivateRequest:async()=>{rmSync(folder,{force:true,recursive:true});return true;},
 };
}
try{
 const stage=await stageLargeAccountExport({
  requestId,collections,services:baseServices()
 });
 assert.equal(stage.recordCount,sourceRows);
 assert.deepEqual(manifest.collections,collections);
 assert(manifest.pages.some(x=>x.collection==='private_media'));
 assert(!JSON.stringify(manifest).includes([...originalMedia.values()][0].toString('base64').slice(0,64)));
 assert.equal(stage.pageCount,archivedCount);
 assert(stage.pageCount>=collections.filter(c=>sourcePages.get(c).some(p=>p.rows.length)).length);
 assert(existsSync(manifestPath));
 assert.equal(manifest.completeUserExport,true,
  'Test-only encrypted transport has a completion receipt distinct from canonical SQL release');
 // Separate adapter instance reloads ONLY persisted ciphertext/manifest files.
 const restoredServices=baseServices();
 const response=await createLargeAccountDownloadResponse({
  requestId,collections,services:restoredServices
 });
 assert.equal(response.status,200);
 assert.match(response.headers.get('Cache-Control'),/no-store/);
 assert(!response.headers.get('Access-Control-Allow-Origin'));
 const verified=await verifyAccountExportDownload({
  stream:response.body,expectedOwnerId:owner,expectedCollections:collections
 });
 assert.equal(verified.verified,true);assert.equal(verified.recordCount,sourceRows);
 // Repeat the trusted request and independently reconstruct ALL owner records
 // from ciphertext to prove byte-for-byte logical roundtrip after disk reload.
 const bytes=Buffer.from(await(await createLargeAccountDownloadResponse({
  requestId,collections,services:restoredServices
 })).arrayBuffer());
 const parsed=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(parsed[0].export_owner,owner);
 assert.equal(parsed.at(-1).export_complete,true);
 assert.deepEqual(parsed.slice(1,-1),originalOwnerRows,
  'Canonical SQL export rows changed after encrypted disk restoration');
 // Reconstruct both binary sources using the audited canonical media chunks
 // inside the SAME 51-collection manifest as all 50 actual SQL collections.
 const recoveredMedia=new Map();
 for(const {collection,record} of parsed.slice(1,-1)){
  if(collection!=='private_media')continue;
  assert.equal(record.user_id,owner);
  assert.equal(record.bucket,'v2-private-workout-objects');
  const chunk=Buffer.from(record.dataBase64,'base64');
  assert.equal(hash(chunk),record.chunkSha256);
  if(!recoveredMedia.has(record.path))recoveredMedia.set(record.path,[]);
  recoveredMedia.get(record.path).push(record);
 }
 assert.equal(recoveredMedia.size,originalMedia.size);
 for(const [path,bytes] of originalMedia){
  const pieces=recoveredMedia.get(path)?.sort((a,b)=>a.part-b.part);
  assert(pieces?.length>0);
  assert.equal(pieces.length,pieces[0].parts);
  assert.equal(pieces[0].fileSha256,hash(bytes));
  assert.equal(pieces[0].fileLength,bytes.length);
  assert.deepEqual(Buffer.concat(pieces.map(p=>Buffer.from(p.dataBase64,'base64'))),bytes,
   'Binary source was altered across encrypted archive restore');
 }

 assert(!bytes.includes(Buffer.from('Owner B private Coach')));
 // An independently authenticated second owner must never open A's archive.
 const foreign={...baseServices(),authorizeExport:async()=>({
  ownerId:other,activeSession:true,exportPermitted:true,
 }),getCanonicalInventory:async()=>({ownerId:other,requestId,snapshotId,collections,complete:true})};
 await assert.rejects(createLargeAccountDownloadResponse({
  requestId,collections,services:foreign
 }),/owner|inventory|mismatch|Unverified|export/i);
 // Revoked request refuses even an already-persisted archive.
 granted=false;
 await assert.rejects(createLargeAccountDownloadResponse({
  requestId,collections,services:restoredServices
 }),/revoked/);
 granted=true;
 // Removing an encrypted page makes complete download fail, not truncate
 // silently or synthesize a verified completion footer.
 const first=manifest.pages[0];
 const backup=readFileSync(p(first.collection,first.index));
 writeFileSync(p(first.collection,first.index),Buffer.from('{"corrupt":true}'));
 await assert.rejects(async()=>{
  const resp=await createLargeAccountDownloadResponse({
   requestId,collections,services:restoredServices
  });
  await verifyAccountExportDownload({
   stream:resp.body,expectedOwnerId:owner,expectedCollections:collections
  });
 },/Invalid|page|envelope|cipher|corrupt|tag|checksum/i);
 writeFileSync(p(first.collection,first.index),backup);
 const recovered=await createLargeAccountDownloadResponse({
  requestId,collections,services:restoredServices
 });
 assert.equal((await verifyAccountExportDownload({
  stream:recovered.body,expectedOwnerId:owner,expectedCollections:collections
 })).recordCount,sourceRows);
 assert(checkCount>sourceRows/4,'Repeated auth gates must run during staging and download');
 console.log('PASS ALL-251: '+collections.length+
  ' reviewed collections (50 actual SQL + 1 test-only audited private media), '+sourceRows+
  ' records including '+mediaRows.length+' media chunks, '+archivedCount+
  ' encrypted durable fixture pages, independently verified download and full logical restoration');
 console.log('REVIEW ONLY: database canonical complete=false; authorization, disk and encryption key are isolated fixtures, not hosted KMS/device release');
}finally{
 rmSync(folder,{recursive:true,force:true});
 key.fill(0);
}
