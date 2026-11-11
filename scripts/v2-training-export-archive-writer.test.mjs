import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createTrainingEncryptedArchiveSink} from './v2-training-export-archive-writer.mjs';
import {stageTrainingPrivateStorageExport} from './v2-training-private-storage-stage.mjs';
import {decryptTrainingExportForVerification} from './v2-training-encrypted-export-envelope.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activity='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const source='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bytes=Buffer.from('private-workout-evidence');
const path=owner+'/'+'a'.repeat(64)+'/sample.fit';
const record={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',user_id:owner,
 activity_id:activity,source_id:source,state:'ready',
 object_path:path,checksum_sha256:createHash('sha256').update(bytes).digest('hex')};
function fixture(opts={}) {
 const key=randomBytes(32);
 let encrypted=null,cleanup=0;
 const sink=createTrainingEncryptedArchiveSink({
  resolveEncryptionKey:async()=>key,
  persistPrivateEnvelope:async ({ownerId,requestId:rid,envelope})=>{
   encrypted=envelope;
   return opts.badReceipt??{archiveId:'private-archive-id',ownerId,requestId:rid,
     encrypted:true,private:true,expiresAt:new Date(Date.now()+3600000).toISOString()};
  },
  deletePrivateRequest:async()=>{cleanup++;return opts.deleteResult??true;},
 });
 let authCalls=0;
 const services={
  ...sink,
  authorizeExport:async()=>{
   authCalls++;
   return {ownerId:owner,activeSession:opts.revokeAfterWrite?authCalls<3:true,
      exportPermitted:true};
  },
  listEvidence:async()=>({ownerId:owner,series:[record],routes:[]}),
  downloadPrivateObject:async()=>bytes,
 };
 return {services,key,get envelope(){return encrypted;},get cleanup(){return cleanup;}};
}
test('stages an encrypted private envelope without returning bytes or key',async()=>{
 const f=fixture();
 const result=await stageTrainingPrivateStorageExport({requestId,services:f.services});
 assert.equal(result.archiveStaged,true);
 assert.equal(result.archiveId,'private-archive-id');
 assert.equal(result.completeUserExport,false);
 assert.equal(JSON.stringify(result).includes(bytes.toString()),false);
 assert.equal(JSON.stringify(f.envelope).includes(bytes.toString()),false);
 const opened=decryptTrainingExportForVerification(f.envelope,f.key,owner,requestId);
 assert.equal(Buffer.from(opened.files[0].bytes,'base64').toString(),bytes.toString());
 assert.equal(f.cleanup,0);
});
test('post-write revocation deletes the exact request archive',async()=>{
 const f=fixture({revokeAfterWrite:true});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/expired/);
 assert.equal(f.cleanup,1);
});
test('missing private/expiring receipt invokes cleanup and rejects success',async()=>{
 const f=fixture({badReceipt:{archiveId:'test',ownerId:owner,requestId,
   encrypted:true,private:false,expiresAt:new Date(Date.now()+3600000).toISOString()}});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/receipt/);
 assert.equal(f.cleanup,1);
});
test('long-lived unbounded archive retention is refused',async()=>{
 const f=fixture({badReceipt:{archiveId:'test',ownerId:owner,requestId,
   encrypted:true,private:true,expiresAt:new Date(Date.now()+48*3600000).toISOString()}});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/expiry/);
 assert.equal(f.cleanup,1);
});
test('uncertain archive purge fails closed and calls for manual cleanup',async()=>{
 const f=fixture({revokeAfterWrite:true,deleteResult:false});
 await assert.rejects(stageTrainingPrivateStorageExport({requestId,services:f.services}),/manual cleanup/);
 assert.equal(f.cleanup,1);
});
