/** ALL-251 local-CI only: real owner-authenticated PostgreSQL RPC pages through
 * the reviewed encrypted large-history transport. This validates the COACH
 * domain on a populated DB, not every canonical ALL-251 data source.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from '../supabase/functions/_shared/trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';
if(process.env.CI!=='true' && process.env.CI!=='1')
 throw Error('Representative database replay only in isolated CI');
const owner='81111111-8111-4111-8111-811111111111';
const other='82222222-8222-4222-8222-822222222222';
const requestId='83333333-8333-4333-8333-833333333333';
const sourceId='84444444-8444-4444-8444-844444444444';
function fromDb(path){
 return readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
const a1=fromDb(process.argv[2]),a2=fromDb(process.argv[3]),b=fromDb(process.argv[4]);
assert.equal(a1.length,100);
assert.equal(a2.length,90);
assert.equal(b.length,2);
const keys=new Set([...a1,...a2].map(x=>x.message_id));
assert.equal(keys.size,190,'auth RLS pages duplicated records');
assert([...a1,...a2].every(x=>x.message_content.includes('representative-coach-history-')));
assert(b.every(x=>x.message_content.startsWith('Owner B private history')));
const rows=[...a1,...a2].map(row=>({...row,user_id:owner}));
const collection='coach_messages';
const key=randomBytes(32),pages=new Map();
let manifest=null,authorized=true,authChecks=0;
const services={
 authorizeExport:async()=>{authChecks++;return {
  ownerId:owner,activeSession:authorized,exportPermitted:authorized,
 };},
 getCanonicalInventory:async({ownerId,requestId:rid})=>({
  ownerId,requestId:rid,complete:true,snapshotId:sourceId,collections:[collection],
 }),
 readPage:async({ownerId,collection:c,cursor,limit})=>{
  assert.equal(ownerId,owner);
  assert.equal(c,collection);
  const start=cursor===null?0:Number(cursor);
  const batch=rows.slice(start,start+Math.min(limit,30));
  const finish=start+batch.length>=rows.length;
  return {ownerId,collection:c,ownerVerified:true,snapshotId:sourceId,
   rows:batch,done:finish,nextCursor:finish?null:String(start+batch.length)};
 },
 resolveEncryptionKey:async()=>key,
 writePrivatePage:async({ownerId,requestId:rid,collection:c,index,sealed})=>{
  pages.set(c+'/'+index,sealed);return {ownerId,requestId:rid,collection:c,index,stored:true};
 },
 commitPrivateManifest:async({ownerId,requestId:rid,manifest:m})=>{
  manifest=m;return {ownerId,requestId:rid,committed:true};
 },
 readPrivateManifest:async()=>manifest,
 readPrivatePage:async({collection:c,index})=>pages.get(c+'/'+index),
 purgePrivateRequest:async()=>{pages.clear();manifest=null;return true;},
};
const receipt=await stageLargeAccountExport({
 requestId,collections:[collection],services,
});
assert(receipt.pageCount>=7);
assert.equal(receipt.recordCount,190);
const response=await createLargeAccountDownloadResponse({
 requestId,collections:[collection],services,
});
const download=await verifyAccountExportDownload({
 stream:response.body,expectedOwnerId:owner,expectedCollections:[collection],
});
assert.equal(download.verified,true);
assert.equal(download.recordCount,190);
assert(authChecks>receipt.pageCount*2);
assert.equal(download.ownerId,owner);
assert(!JSON.stringify(manifest).includes('Owner B private history'));
authorized=false;
await assert.rejects(createLargeAccountDownloadResponse({
 requestId,collections:[collection],services,
}),/revoked/);
console.log('PASS ALL-251: 190 real authenticated PostgreSQL Coach messages across two RPC pages, encrypted streaming, integrity and owner isolation (domain-scoped representative evidence)');
