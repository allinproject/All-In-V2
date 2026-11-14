import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251R2StorageFacade} from './all251R2StorageReviewAdapter.mjs';
import {createPrivilegedStorageWriter} from './trainingPrivilegedStorageWriter.mjs';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const LEASE='33333333-3333-4333-8333-333333333333';
const BUCKET='v2-private-workout-objects';
const bytes=()=>new TextEncoder().encode('private synthetic workout bytes');

function fixture(){
 const records=new Map();let seq=0,mutateAfterHead=false,corruptRead=false;
 const binding={
  async head(key){
   const record=records.get(key);
   if(mutateAfterHead&&record)record.etag='concurrent-change';
   return record?{etag:'v'+record.originalSeq}:null;
  },
  async put(key,data,{onlyIf}={}){
   const old=records.get(key);
   if(onlyIf?.etagDoesNotMatch==='*'&&old)return null;
   if(onlyIf?.etagMatches!==undefined&&
      (!old||old.etag!==onlyIf.etagMatches))return null;
   records.set(key,{etag:'v'+(++seq),originalSeq:seq,bytes:Uint8Array.from(data)});
   return {etag:'v'+seq};
  },
  async get(key){
   const entry=records.get(key);
   if(!entry)return null;
   return {arrayBuffer:async()=>{
    const content=Uint8Array.from(entry.bytes);
    if(corruptRead)content[0]^=1;
    return content.buffer;
   }};
  },
 };
 const storage=createAll251R2StorageFacade({binding,logicalBucketId:BUCKET});
 let began=0,settled=0,denyLease=false;
 const authority={
  async begin(){began++;return denyLease?
   {data:null,error:{code:'FROZEN'}}:{data:LEASE,error:null};},
  async settle(){settled++;return {data:true,error:null};},
 };
 const writer=createPrivilegedStorageWriter({
  supabase:{rpc:async()=>{throw Error('Unsigned RPC forbidden');},storage},
  leaseAuthority:authority,requireAttestedLease:true,
 });
 return {storage,writer,records,setCorrupt:v=>corruptRead=v,
  setDenyLease:v=>denyLease=v,setConcurrent:v=>mutateAfterHead=v,
  counters:()=>({began,settled})};
}

test('canonical lease/write/readback/settlement works with private R2 binding',async()=>{
 const f=fixture(),path=A+'/synthetic.bin';
 const receipt=await f.writer.write({
  verifiedOwnerId:A,bucketId:BUCKET,path,bytes:bytes(),
  operation:'create',contentType:'application/octet-stream',
 });
 assert.equal(receipt.verified,true);
 assert.deepEqual(f.counters(),{began:1,settled:1});
 assert.deepEqual(f.records.get(path).bytes,bytes());
});

test('frozen account never calls storage and leaves no settlement',async()=>{
 const f=fixture();f.setDenyLease(true);
 await assert.rejects(f.writer.write({
  verifiedOwnerId:A,bucketId:BUCKET,path:A+'/frozen.bin',bytes:bytes(),
  operation:'create',contentType:'application/octet-stream',
 }),/lease unavailable/);
 assert.equal(f.records.size,0);
 assert.deepEqual(f.counters(),{began:1,settled:0});
});

test('mismatched byte readback prevents lease settlement',async()=>{
 const f=fixture();f.setCorrupt(true);
 await assert.rejects(f.writer.write({
  verifiedOwnerId:A,bucketId:BUCKET,path:A+'/corrupt.bin',bytes:bytes(),
  operation:'create',contentType:'application/octet-stream',
 }),/bytes differ/);
 assert.deepEqual(f.counters(),{began:1,settled:0});
});

test('bucket and path restrictions cannot be bypassed',async()=>{
 const f=fixture();
 assert.throws(()=>f.storage.from('other-bucket'),/Unapproved/);
 await assert.rejects(f.writer.write({
  verifiedOwnerId:A,bucketId:BUCKET,path:B+'/cross-owner.bin',bytes:bytes(),
  operation:'create',contentType:'application/octet-stream',
 }),/Invalid scoped/);
 assert.equal(f.records.size,0);
 assert.deepEqual(f.counters(),{began:0,settled:0});
});

test('create is atomic and never overwrites an existing key',async()=>{
 const f=fixture(),s=f.storage.from(BUCKET);
 assert.equal((await s.upload(A+'/existing.bin',bytes(),{
  contentType:'application/octet-stream',upsert:false})).error,null);
 const conflicting=await s.upload(A+'/existing.bin',new Uint8Array([1]),{
  contentType:'application/octet-stream',upsert:false});
 assert.equal(conflicting.error.code,'EXISTS_OR_CONFLICT');
 assert.deepEqual(f.records.get(A+'/existing.bin').bytes,bytes());
});

test('replace is conditional and does not silently overwrite concurrent writes',async()=>{
 const f=fixture(),s=f.storage.from(BUCKET);
 await s.upload(A+'/replace.bin',bytes(),{contentType:'application/octet-stream'});
 f.setConcurrent(true);
 const replacement=await s.update(A+'/replace.bin',new Uint8Array([9]),{
  contentType:'application/octet-stream'});
 assert.equal(replacement.error.code,'REPLACE_CONFLICT');
 assert.deepEqual(f.records.get(A+'/replace.bin').bytes,bytes());
});

test('attested-only writer never silently falls back to unsigned RPC',()=>{
 const f=fixture();
 assert.throws(()=>createPrivilegedStorageWriter({
  supabase:{rpc:async()=>{},storage:f.storage},requireAttestedLease:true,
 }),/Attested privileged Storage lease authority required/);
});
