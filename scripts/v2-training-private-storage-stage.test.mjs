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

test('writes only after verified bytes, checks authorization again, returns no secret bytes',async()=>{
 const f=fixture();
 let handoff=null;
 f.services.writeEncryptedArchive=async payload=>{
   f.calls.push('write');
   handoff=payload;
   return {encrypted:true,ownerId:owner,requestId,archiveId:'staged-qa-1',secret:'do-not-return'};
 };
 f.services.deleteStagedArchive=async()=>{f.calls.push('cleanup');};
 const result=await stageTrainingPrivateStorageExport({requestId,services:f.services});
 assert.deepEqual(f.calls.map(x=>x.split(':')[0]),
   ['auth','list','download','auth','list','write','auth','list']);
 assert.equal(handoff.files.length,1);
 assert.equal(handoff.files[0].bytes.toString(),'synthetic trainer data');
 assert.equal(result.archiveStaged,true);
 assert.equal(result.archiveId,'staged-qa-1');
 assert.equal(result.secret,undefined);
 assert.equal(result.completeUserExport,false);
 assert.equal(f.calls.includes('cleanup'),false);
});
test('no unverified or mutated private bytes ever reach archive writer',async()=>{
 const f=fixture({downloadPrivateObject:async()=>Buffer.from('altered')});
 let called=false;
 f.services.writeEncryptedArchive=async()=>{called=true;throw new Error('must not execute');};
 f.services.deleteStagedArchive=async()=>{};
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/checksum/);
 assert.equal(called,false);
});
test('staged archive purged on post-write revocation or metadata change',async()=>{
 for(const fail of ['auth','metadata']) {
  let auth=0;
  let listed=0;
  const f=fixture();
  f.services.authorizeExport=async()=>{
    auth++; f.calls.push('auth');
    return {ownerId:owner,activeSession:fail==='auth'?auth<3:true,exportPermitted:true};
  };
  f.services.listEvidence=async()=>{
    listed++;f.calls.push('list');
    return {ownerId:owner,series:[{
      ...row(),state:fail==='metadata'&&listed>=3?'revoked':'ready',
    }],routes:[]};
  };
  f.services.writeEncryptedArchive=async()=>{
    f.calls.push('write');
    return {encrypted:true,ownerId:owner,requestId,archiveId:'qa'};
  };
  f.services.deleteStagedArchive=async()=>{f.calls.push('cleanup');};
  await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/expired|changed/);
  assert.equal(f.calls.filter(x=>x==='cleanup').length,1);
 }
});
test('ambiguous archive write invokes request-scoped cleanup, never claims delivery',async()=>{
 const f=fixture();
 f.services.writeEncryptedArchive=async()=>{throw new Error('lost server response');};
 let cleanup=0;
 f.services.deleteStagedArchive=async()=>{cleanup++;};
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/lost server response/);
 assert.equal(cleanup,1);
});
test('failed cleanup produces explicit manual recovery incident instead of success',async()=>{
 const f=fixture();
 f.services.writeEncryptedArchive=async()=>{throw new Error('ambiguous write');};
 f.services.deleteStagedArchive=async()=>{throw new Error('cleanup unavailable');};
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),
  /manual cleanup required/);
});
test('archive handoff requires both write and cleanup adapters',async()=>{
 const f=fixture();
 f.services.writeEncryptedArchive=async()=>({});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),
  /writer and cleanup/);
});
