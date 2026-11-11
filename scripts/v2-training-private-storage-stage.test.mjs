import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stageTrainingPrivateStorageExport } from './v2-training-private-storage-stage.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activityId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bytes=Buffer.from('synthetic trainer data');
const row=()=>({
 id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',user_id:owner,
 activity_id:activityId,source_id:sourceId,
 object_path:owner+'/'+ 'x'.repeat(64) + '/series.fit',
 checksum_sha256:createHash('sha256').update(bytes).digest('hex'),
 state:'ready',quality:'trusted',
});
function fixture(overrides={}) {
 const calls=[];
 const series=[row()];
 const services={
  authorizeExport:async ()=>{calls.push('auth');return {ownerId:owner,activeSession:true,exportPermitted:true};},
  listEvidence:async ()=>{calls.push('list');return {ownerId:owner,series,routes:[]};},
  downloadPrivateObject:async ({path})=>{calls.push('download:'+path);return bytes;},
  ...overrides,
 };
 return {services,calls};
}
test('stages actual private bytes after server authorization, with recheck and incomplete result',async()=>{
 const f=fixture();
 const result=await stageTrainingPrivateStorageExport({requestId,services:f.services});
 assert.equal(result.verifiedFileCount,1);
 assert.equal(result.inspectedBytes,bytes.length);
 assert.equal(result.completeUserExport,false);
 assert.equal(result.storageAuthorizationVerified,false);
 assert.deepEqual(f.calls.map(c=>c.split(':')[0]),['auth','list','download','auth','list']);
});
test('denied or changed owner never allows private downloads',async()=>{
 let f=fixture({authorizeExport:async()=>({ownerId:other,activeSession:false})});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/authorized/);
 f=fixture({listEvidence:async()=>({ownerId:other,series:[row()],routes:[]})});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/snapshot/);
 assert.equal(f.calls.some(c=>c.startsWith('download')),false);
});
test('unsafe path, foreign row, and pending objects fail before download',async()=>{
 for(const modified of [
  {user_id:other},{state:'pending'},
  {object_path:owner+'/../'+ 'x'.repeat(64)},
 ]) {
  const f=fixture({listEvidence:async()=>({ownerId:owner,series:[{...row(),...modified}],routes:[]})});
  await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/Unapproved/);
  assert.equal(f.calls.some(c=>c.startsWith('download')),false);
 }
});
test('rejects missing or altered private bytes, never marks export complete',async()=>{
 for(const actual of [new Uint8Array(),Buffer.from('corrupted')]) {
  const f=fixture({downloadPrivateObject:async()=>actual});
  await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/Missing|checksum/);
 }
});
test('enforces bounded count and bytes',async()=>{
 const f=fixture();
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services,maxBytes:4}),/oversized/);
 const f2=fixture({listEvidence:async()=>({ownerId:owner,series:[row(),row()],routes:[]})});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f2.services,maxFiles:1}),/count/);
});
test('aborts if session revoked or object metadata changed mid-export',async()=>{
 let authCount=0;
 let f=fixture({authorizeExport:async()=>({
   ownerId:owner,activeSession:++authCount===1,exportPermitted:true,
 })});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/expired/);
 let listCount=0;
 f=fixture({listEvidence:async()=>({
   ownerId:owner,series:[{...row(),state:++listCount===1?'ready':'revoked'}],routes:[],
 })});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/changed/);
});
test('route export requires private or redacted route status',async()=>{
 const route={...row(),privacy_state:'private'};
 const f=fixture({listEvidence:async()=>({ownerId:owner,series:[],routes:[route]})});
 const out=await stageTrainingPrivateStorageExport({requestId,services:f.services});
 assert.equal(out.files[0].kind,'route');
 const bad=fixture({listEvidence:async()=>({ownerId:owner,series:[],routes:[{...route,privacy_state:'public'}]})});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:bad.services}),/Unapproved/);
});
