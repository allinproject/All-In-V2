import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivilegedAccountExportBarrier} from './trainingPrivilegedAccountExportBarrier.mjs';
import {createSupabasePrivateArchivePersistence} from './trainingExportSupabaseArchive.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const leaseId='33333333-3333-4333-8333-333333333333';
const path=owner+'/'+requestId+'/archive.aesgcm.json';
function fixture(changes={}){
 const calls=[];
 let stored=null;
 const serviceClient={
  rpc:async(name,args)=>{
   calls.push(name);
   if(name==='v2_begin_privileged_storage_write_review')
    return {data:leaseId,error:null};
   return {data:true,error:null};
  },
  storage:{
   getBucket:async()=>({data:{id:'v2-private-account-exports',public:false},error:null}),
   from:()=>{
    calls.push('from');
    return {
     upload:async(p,blob)=>{
      calls.push('upload');
      stored=new Uint8Array(await blob.arrayBuffer());
      return {data:{path:p},error:null};
     },
     download:async()=>{
      calls.push('download');
      return {data:{arrayBuffer:async()=>stored.buffer},error:null};
     },
    };
   },
  },
 };
 if(changes.rpc)serviceClient.rpc=async(name,args)=>{
  calls.push(name);return changes.rpc(name,args);
 };
 const barrier=createPrivilegedAccountExportBarrier({serviceClient});
 const archive=createSupabasePrivateArchivePersistence({
  serviceClient,withOwnerStorageWriteBarrier:barrier,
  readApprovedRequestExpiry:async()=>({ownerId:owner,requestId,status:'approved',
   cancelled:false,expiresAt:new Date(Date.now()+3600000).toISOString()}),
 });
 const envelope={ownerId:owner,requestId,
  version:'allin-v2-training-encrypted-export-v1',
  algorithm:'AES-256-GCM',completeUserExport:false,
  downloadAuthorized:false,ciphertext:'encrypted'};
 return {archive,barrier,envelope,calls};
}
test('canonical encrypted archive calls lease + Storage + byte readback + settlement',async()=>{
 const f=fixture();
 const receipt=await f.archive.persistPrivateEnvelope({
  ownerId:owner,requestId,envelope:f.envelope});
 assert.equal(receipt.archiveId,path);
 assert.deepEqual(f.calls.filter(x=>x!=='from'),[
  'v2_begin_privileged_storage_write_review','upload',
  'download','v2_settle_privileged_storage_write_review']);
});
test('unsettled or denied DB write never falsely completes archive',async()=>{
 for(const answer of [
  async()=>({data:null,error:{code:'denied'}}),
  async(name)=>name==='v2_begin_privileged_storage_write_review'
   ? {data:leaseId,error:null}:{data:false,error:null},
 ]){
  const f=fixture({rpc:answer});
  await assert.rejects(f.archive.persistPrivateEnvelope({
   ownerId:owner,requestId,envelope:f.envelope}));
  if(f.calls[0]==='v2_begin_privileged_storage_write_review'&&
   f.calls.filter(x=>x==='upload').length===0)
   assert.equal(f.calls.includes('v2_settle_privileged_storage_write_review'),false);
 }
});
test('export barrier rejects cross-request and arbitrary bucket before lease',async()=>{
 const f=fixture();
 await assert.rejects(f.barrier({ownerId:owner,requestId,bucketId:'public',
  objectPath:path,operation:'insert',bytes:new Uint8Array([1]),
  contentType:'application/octet-stream',write:async()=>({})}));
 await assert.rejects(f.barrier({ownerId:owner,requestId,
  bucketId:'v2-private-account-exports',objectPath:owner+'/another/manifest.json',
  operation:'insert',bytes:new Uint8Array([1]),
  contentType:'application/octet-stream',write:async()=>({})}));
 assert.deepEqual(f.calls,[]);
});
