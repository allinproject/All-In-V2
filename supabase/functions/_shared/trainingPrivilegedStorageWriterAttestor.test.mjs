import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttestedPrivilegedStorageLeaseAuthority} from
 './trainingPrivilegedStorageWriterAttestor.mjs';
import {createPrivilegedStorageWriter} from './trainingPrivilegedStorageWriter.mjs';
const owner='a8111111-8111-4111-8111-811111111111';
const leaseId='c8333333-8333-4333-8333-833333333333';
const bucketId='v2-private-workout-objects',path=owner+'/data.fit';
const bytes=new Uint8Array([1,2,3,4]);
const signingKey=new Uint8Array(32).fill(67);
const encoder=new TextEncoder();
const hex=u=>Array.from(u,x=>x.toString(16).padStart(2,'0')).join('');
function fixtures(){
 const calls=[];
 const supabase={
  rpc:async(name,args)=>{
   calls.push([name,args]);
   return {data:name.includes('begin')?leaseId:true,error:null};
  },
  storage:{from:()=>({
   upload:async()=>({data:{path},error:null}),
   download:async()=>({data:{arrayBuffer:async()=>bytes.buffer},error:null}),
  })},
 };
 return {supabase,calls};
}
test('exact byte SHA-256 and separate writer HMAC authorize the canonical writer only',async()=>{
 const f=fixtures();
 const authority=createAttestedPrivilegedStorageLeaseAuthority({
  supabase:f.supabase,signingKey,
 });
 const writer=createPrivilegedStorageWriter({
  supabase:f.supabase,leaseAuthority:authority,
 });
 assert.equal((await writer.write({verifiedOwnerId:owner,bucketId,path,
  bytes,operation:'create',contentType:'application/octet-stream'})).verified,true);
 assert.deepEqual(f.calls.map(x=>x[0]),[
  'v2_begin_privileged_storage_write_attested_review',
  'v2_settle_privileged_storage_write_attested_review',
 ]);
 const [begin,settle]=f.calls.map(x=>x[1]);
 assert.equal(begin.p_owner_id,owner);
 assert.equal(begin.p_bucket_id,bucketId);
 assert.equal(begin.p_object_path,path);
 assert.equal(begin.p_sha256.length,64);
 assert.equal(begin.p_sha256,hex(new Uint8Array(
  await crypto.subtle.digest('SHA-256',bytes))));
 assert.equal(settle.p_owner_id,owner);
 assert.equal(settle.p_lease_id,leaseId);
 assert.notEqual(begin.p_nonce,settle.p_nonce);
 const key=await crypto.subtle.importKey('raw',signingKey,
  {name:'HMAC',hash:'SHA-256'},false,['verify']);
 const message=['v2-writer-v1','begin',owner,bucketId,path,'create',
  begin.p_sha256,'',begin.p_nonce,String(begin.p_issued_epoch)].join('|');
 assert.equal(await crypto.subtle.verify('HMAC',key,
  Uint8Array.from(begin.p_signature.match(/../g),x=>parseInt(x,16)),
  encoder.encode(message)),true);
 assert.equal(await crypto.subtle.verify('HMAC',key,
  Uint8Array.from(begin.p_signature.match(/../g),x=>parseInt(x,16)),
  encoder.encode(message.replace(path,owner+'/forged.fit'))),false);
 assert.equal(Object.values(begin).includes(signingKey),false);
});
test('missing signer material and malformed lease inputs fail closed',async()=>{
 const f=fixtures();
 for(const bad of [undefined,null,new Uint8Array(8),'example-secret']){
  assert.throws(()=>createAttestedPrivilegedStorageLeaseAuthority({
   supabase:f.supabase,signingKey:bad}),/signing material/);
 }
 assert.throws(()=>createPrivilegedStorageWriter({
  supabase:f.supabase,leaseAuthority:{begin:async()=>({})}
 }),/attested privileged/);
 const authority=createAttestedPrivilegedStorageLeaseAuthority({
  supabase:f.supabase,signingKey,
 });
 await assert.rejects(authority.begin({ownerId:'not-a-user',bucketId,
  path,operation:'create',bytes}),/Untrusted Storage/);
 assert.equal(f.calls.length,0);
});
