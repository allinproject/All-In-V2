import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabasePrivateArchivePersistence,purgeExpiredAccountExportArchives,PRIVATE_ACCOUNT_EXPORT_BUCKET}
 from './trainingExportSupabaseArchive.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const path=owner+'/'+requestId+'/archive.aesgcm.json';
const lease=()=>({ownerId:owner,requestId,status:'approved',
 cancelled:false,expiresAt:new Date(Date.now()+3600000).toISOString()});
const envelope=()=>({version:'allin-v2-training-encrypted-export-v1',
 ownerId:owner,requestId,algorithm:'AES-256-GCM',
 completeUserExport:false,downloadAuthorized:false,
 iv:'random',tag:'authentication',ciphertext:'opaqueEncryptedBytes'});
function fixture(config={}) {
 const events=[];
 const serviceClient={
  storage:{
   async getBucket(id){
    events.push(['bucket',id]);
    return {data:{id,public:config.publicBucket??false},error:null};
   },
   from(bucket){
    events.push(['from',bucket]);
    return {
      async upload(filePath,blob,options){
       events.push(['upload',filePath,options,await blob.text()]);
       return config.badUpload ? {data:null,error:new Error('upload failed')}:
        {data:{path:filePath},error:null};
      },
      async remove(paths){
       events.push(['remove',paths]);
       return config.badRemoval ? {data:null,error:new Error('remove failed')}:
        {data:paths.map(name=>({name})),error:null};
      },
    };
   },
  },
 };
 let leases=0;
 const adapter=createSupabasePrivateArchivePersistence({
  serviceClient,readApprovedRequestExpiry:async()=>{
   leases++;return Object.prototype.hasOwnProperty.call(config,'lease')?config.lease:lease();
  },
 });
 return {adapter,events,get leases(){return leases}};
}
test('uploads only encrypted envelope to fixed private bucket under exact owner/request path',async()=>{
 const f=fixture();
 const receipt=await f.adapter.persistPrivateEnvelope({ownerId:owner,requestId,envelope:envelope()});
 assert.equal(receipt.archiveId,path);
 assert.equal(receipt.private,true);
 assert.equal(receipt.encrypted,true);
 assert.equal(f.leases,1);
 const u=f.events.find(x=>x[0]==='upload');
 assert.equal(u[1],path);
 assert.equal(u[2].upsert,false);
 assert.equal(u[2].contentType,'application/octet-stream');
 assert.equal(JSON.parse(u[3]).ciphertext,'opaqueEncryptedBytes');
 assert(f.events.some(x=>x[0]==='bucket'&&x[1]===PRIVATE_ACCOUNT_EXPORT_BUCKET));
 assert(f.events.filter(x=>x[0]==='from').every(x=>x[1]===PRIVATE_ACCOUNT_EXPORT_BUCKET));
});
test('unapproved, expired or mismatched request never touches private bucket',async()=>{
 for(const invalid of [
  null,{...lease(),status:'requested'},
  {...lease(),ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  {...lease(),expiresAt:new Date(Date.now()-1000).toISOString()},
  {...lease(),expiresAt:new Date(Date.now()+48*3600000).toISOString()},
 ]) {
  const f=fixture({lease:invalid});
  await assert.rejects(f.adapter.persistPrivateEnvelope({
   ownerId:owner,requestId,envelope:envelope(),
  }),/lease/);
  assert.equal(f.events.length,0);
 }
});
test('rejects public export bucket, bad envelope and ambiguous upload response',async()=>{
 const publicBucket=fixture({publicBucket:true});
 await assert.rejects(publicBucket.adapter.persistPrivateEnvelope({
  ownerId:owner,requestId,envelope:envelope(),
 }),/public/);
 assert.equal(publicBucket.events.some(x=>x[0]==='upload'),false);
 const wrong=fixture();
 await assert.rejects(wrong.adapter.persistPrivateEnvelope({
  ownerId:owner,requestId,envelope:{...envelope(),ownerId:'foreign'},
 }),/Unverified/);
 assert.equal(wrong.events.length,0);
 const fail=fixture({badUpload:true});
 await assert.rejects(fail.adapter.persistPrivateEnvelope({
  ownerId:owner,requestId,envelope:envelope(),
 }),/not confirmed/);
});
test('cleans up exact archive through Storage API, not database delete',async()=>{
 const f=fixture();
 assert.equal(await f.adapter.deletePrivateRequest({ownerId:owner,requestId}),true);
 assert.deepEqual(f.events.find(x=>x[0]==='remove')[1],[path]);
});
test('unconfirmed purge fails closed; malformed owner IDs do not reach Storage',async()=>{
 const f=fixture({badRemoval:true});
 await assert.rejects(f.adapter.deletePrivateRequest({ownerId:owner,requestId}),/not confirmed/);
 const f2=fixture();
 await assert.rejects(f2.adapter.deletePrivateRequest({ownerId:'invalid',requestId}),/Exact/);
 assert.equal(f2.events.length,0);
});

test('retention sweeper deletes only expired or cancelled leases through existing owner-bound Storage cleanup',async()=>{
 const f=fixture();const events=[];
 const expired=new Date(Date.now()-60000).toISOString();
 const result=await purgeExpiredAccountExportArchives({
  listPurgeCandidates:async()=>[{ownerId:owner,requestId,status:'expired',expiresAt:expired}],
  deletePrivateRequest:f.adapter.deletePrivateRequest,
  recordPurgeReceipt:async input=>{events.push(input);return {...input,purged:true};},
 });
 assert.equal(result.purgedCount,1);
 assert.deepEqual(f.events.find(x=>x[0]==='remove')[1],[path]);
 assert.equal(events[0].ownerId,owner);
});
test('retention preflights all candidates before touching Storage',async()=>{
 for(const rows of [
  [{ownerId:owner,requestId,status:'approved',expiresAt:new Date(Date.now()+3600000).toISOString()}],
  [{ownerId:owner,requestId,status:'expired',expiresAt:new Date(Date.now()-1000).toISOString()},
   {ownerId:owner,requestId,status:'expired',expiresAt:new Date(Date.now()-1000).toISOString()}],
  [{ownerId:'someone-else',requestId,status:'expired',expiresAt:new Date(Date.now()-1000).toISOString()}],
 ]) {
  const f=fixture();
  await assert.rejects(purgeExpiredAccountExportArchives({
   listPurgeCandidates:async()=>rows,
   deletePrivateRequest:f.adapter.deletePrivateRequest,
   recordPurgeReceipt:async input=>({...input,purged:true}),
  }),/Unapproved/);
  assert.equal(f.events.length,0);
 }
});
test('ambiguous archive removal or missing audit receipt never signals successful retention',async()=>{
 const expired=new Date(Date.now()-60000).toISOString();
 const candidates=async()=>[{ownerId:owner,requestId,status:'expired',expiresAt:expired}];
 const f=fixture({badRemoval:true});
 await assert.rejects(purgeExpiredAccountExportArchives({
  listPurgeCandidates:candidates,
  deletePrivateRequest:f.adapter.deletePrivateRequest,
  recordPurgeReceipt:async input=>({...input,purged:true}),
 }),/not confirmed/);
 const good=fixture();
 await assert.rejects(purgeExpiredAccountExportArchives({
  listPurgeCandidates:candidates,
  deletePrivateRequest:good.adapter.deletePrivateRequest,
  recordPurgeReceipt:async()=>null,
 }),/manual reconciliation/);
});
