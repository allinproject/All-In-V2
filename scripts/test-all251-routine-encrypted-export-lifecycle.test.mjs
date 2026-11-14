/** ALL-251 / ALL-246 review-only regression. Mocked approved pinned inventory.
 * Exercises the existing encrypted account-export pipeline with portable
 * Saved Routine records. NOT a substitute for all-domain or real R2 acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from
 '../supabase/functions/_shared/trainingExportLargeArchive.mjs';
import {verifyAccountExportDownload} from
 '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const request='33333333-3333-4333-8333-333333333333';
const snapshot='44444444-4444-4444-8444-444444444444';
const templates='public.v2_training_routines';
const versions='public.v2_training_routine_versions';
const collections=[templates,versions];

function fixture(options={}){
 const key=randomBytes(32),stored=new Map();
 const routine='55555555-5555-4555-8555-555555555555';
 const records={
  [templates]:Array.from({length:32},(_,i)=>({
    id:i===0?routine:'66666666-6666-4666-8666-'+String(i).padStart(12,'0'),
    user_id:owner,current_version:i===0?2:1,
    is_favorite:i===0,archived_at:i===0?'2026-11-13T00:00:00Z':null,
  })),
  [versions]:[
   {routine_id:routine,user_id:owner,version:1,schema_version:1,
    name:'Original strength template',sport:'strength',
    notes:'Original athlete-authored plan',
    blocks:[{kind:'strength',id:'step1',exercise:'Squat',sets:3,reps:'5'}],
    source_kind:'athlete_authored'},
   {routine_id:routine,user_id:owner,version:2,schema_version:1,
    name:'Archived revised template',sport:'strength',
    notes:'Revised athlete-authored plan',
    blocks:[{kind:'strength',id:'step2',exercise:'Squat',sets:4,reps:'5'}],
    source_kind:'athlete_authored'},
  ],
 };
 let manifest=null,revoked=false,purges=0;
 const services={
  authorizeExport:async()=>({ownerId:options.asOther?other:owner,
    activeSession:!revoked,exportPermitted:!revoked}),
  getCanonicalInventory:async()=>({
    ownerId:options.asOther?other:owner,requestId:request,
    snapshotId:snapshot,complete:options.incomplete!==true,
    collections:options.omitVersions?[templates]:collections,
  }),
  readPage:async({ownerId,requestId,collection,cursor,limit})=>{
   assert.equal(ownerId,owner);assert.equal(requestId,request);
   const offset=cursor===null?0:Number(cursor);
   const rows=records[collection].slice(offset,offset+Math.min(limit,25));
   if(options.crossOwner&&collection===templates&&offset===0)
     rows.push({id:'foreign',user_id:other});
   const done=offset+rows.length>=records[collection].length;
   return {ownerId,collection,snapshotId:snapshot,ownerVerified:true,
    rows,done,nextCursor:done?null:String(offset+rows.length)};
  },
  resolveEncryptionKey:async()=>key,
  writePrivatePage:async({ownerId,requestId,collection,index,sealed})=>{
   assert.equal(ownerId,owner);assert.equal(requestId,request);
   stored.set(collection+'/'+index,sealed);
   return {ownerId,requestId,collection,index,stored:true};
  },
  commitPrivateManifest:async({ownerId,requestId,manifest:m})=>{
   assert.equal(ownerId,owner);assert.equal(requestId,request);
   manifest=m;return {ownerId,requestId,committed:true};
  },
  readPrivateManifest:async()=>manifest,
  readPrivatePage:async({collection,index})=>stored.get(collection+'/'+index),
  purgePrivateRequest:async()=>{purges++;stored.clear();manifest=null;return true;},
 };
 return {services,records,stored,get manifest(){return manifest;},
  get purges(){return purges;},revoke(){revoked=true;}};
}
async function stage(f){return stageLargeAccountExport({
 requestId:request,collections,services:f.services,
});}
async function open(f){return createLargeAccountDownloadResponse({
 requestId:request,collections,services:f.services,
});}
test('Saved Routine pages remain private/encrypted, archived versions survive verified download',async()=>{
 const f=fixture();
 const receipt=await stage(f);
 assert.equal(receipt.recordCount,34);
 assert.equal(receipt.pageCount,3);
 assert.equal(receipt.completeUserExport,true); // only approved MOCK inventory
 assert.equal(f.manifest.pages.length,3);
 assert.equal(f.manifest.encrypted,true);
 const envelope=JSON.stringify([...f.stored.values()]);
 assert(!envelope.includes('Archived revised template'),'ciphertext leaked names');
 assert(!envelope.includes('Squat'),'ciphertext leaked exercise structure');
 const response=await open(f);
 const chunks=[];const reader=response.body.getReader();
 while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);}
 const plain=Buffer.concat(chunks.map(v=>Buffer.from(v))).toString('utf8');
 assert(plain.includes('Archived revised template'));
 assert(plain.includes('Original strength template'));
 const records=plain.trim().split('\n').slice(1,-1).map(JSON.parse);
 assert.equal(records.length,34);
 assert.equal(records.filter(r=>r.collection===templates).length,32);
 assert.equal(records.filter(r=>r.collection===versions).length,2);
 assert(records.every(r=>r.record.user_id===owner));
 assert(!plain.includes('payload_digest'));
 assert(!plain.includes('allin_private.v2_training_routine_actions'));
 // Download verification is independent of the writer and checks footer SHA.
 const verified=await verifyAccountExportDownload({
  stream:new ReadableStream({start(c){for(const x of chunks)c.enqueue(x);c.close();}}),
  expectedOwnerId:owner,expectedCollections:collections,
 });
 assert.equal(verified.verified,true);assert.equal(verified.recordCount,34);
});
test('missing Routine version collection and incomplete canonical inventory fail closed',async()=>{
 for(const opts of [{omitVersions:true},{incomplete:true}]){
  const f=fixture(opts);
  await assert.rejects(stage(f),/Canonical owner export inventory incomplete/);
  assert.equal(f.manifest,null);assert.equal(f.stored.size,0);
 }
});
test('cross-owner Routine row cancels export and purges staged pages',async()=>{
 const f=fixture({crossOwner:true});
 await assert.rejects(stage(f),/Invalid canonical account export page/);
 assert.equal(f.manifest,null);assert.equal(f.stored.size,0);
 assert.equal(f.purges,1);
});
test('tampered Routine encrypted page never completes a download',async()=>{
 const f=fixture();await stage(f);
 const first=f.stored.get(templates+'/0');
 assert(first);
 f.stored.set(templates+'/0',{...first,
  ciphertext:Buffer.from('tampered').toString('base64')});
 await assert.rejects(async()=>{
  const response=await open(f);
  await verifyAccountExportDownload({
   stream:response.body,expectedOwnerId:owner,expectedCollections:collections,
  });
 },/authenticat|checksum|decrypt|bad decrypt|operation failed|Invalid/i);
});
test('revoked Auth session denies previously staged Routine download',async()=>{
 const f=fixture();await stage(f);f.revoke();
 await assert.rejects(open(f),/Export session or request revoked/);
});
