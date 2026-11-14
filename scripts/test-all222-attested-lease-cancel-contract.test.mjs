// ALL-222 — isolated local contract checks for attested cancellation.
// No Supabase traffic and no real credentials; use synthetic bytes and HMAC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {createAttestedPrivilegedStorageLeaseAuthority} from
 '../supabase/functions/_shared/trainingPrivilegedStorageWriterAttestor.mjs';

const owner='4eac09be-9845-48db-9348-474e5c08e6e8';
const leaseId='4a5c3ccc-ed0a-40fa-8e77-8324c992956e';
const bucket='v2-private-workout-objects';
const path=owner+'/all222-local-cancel.bin';
const bytes=Uint8Array.from([1,2,3,4,5,6]);
function harness(){
 const key=new Uint8Array(randomBytes(32));
 const calls=[];
 const supabase={rpc:async(name,args)=>{
  calls.push({name,args});
  return {data:true,error:null};
 }};
 const authority=createAttestedPrivilegedStorageLeaseAuthority({supabase,signingKey:key});
 return {key,calls,authority};
}
test('cancel signs canonical exact lease scope; no caller-facing key',async()=>{
 const {key,calls,authority}=harness();
 const receipt=await authority.cancel({ownerId:owner,leaseId,bucketId:bucket,
  path,operation:'create',bytes});
 assert.deepEqual(receipt,{data:true,error:null});
 assert.equal(calls.length,1);
 const {name,args}=calls[0];
 assert.equal(name,'v2_cancel_privileged_storage_write_attested_review');
 assert.equal(args.p_owner_id,owner);
 assert.equal(args.p_lease_id,leaseId);
 assert.equal(args.p_bucket_id,bucket);
 assert.equal(args.p_object_path,path);
 assert.equal(args.p_operation,'create');
 const digest=createHash('sha256').update(bytes).digest('hex');
 assert.equal(args.p_sha256,digest);
 const message=['v2-writer-v1','cancel',owner,bucket,path,'create',
  digest,leaseId,args.p_nonce,String(args.p_issued_epoch)].join('|');
 assert.equal(args.p_signature,createHmac('sha256',key).update(message).digest('hex'));
 assert.equal(Object.hasOwn(args,'signingKey'),false);
 assert.equal(Object.hasOwn(args,'p_signing_key'),false);
});
test('cancel requires a real UUID lease and typed nonempty object bytes',async()=>{
 const {authority,calls}=harness();
 for(const bad of [
  {ownerId:owner,leaseId:'fake',bucketId:bucket,path,operation:'create',bytes},
  {ownerId:owner,leaseId,bucketId:bucket,path,operation:'create',bytes:new Uint8Array()},
  {ownerId:owner,leaseId,bucketId:bucket,path,operation:'replace',bytes:'untrusted'}
 ]){
  await assert.rejects(authority.cancel(bad),/Untrusted Storage attestation scope/);
 }
 assert.equal(calls.length,0);
});
test('cancellation uses fresh nonces, never a settle or begin action',async()=>{
 const {authority,calls}=harness();
 for(let i=0;i<2;i++){
  await authority.cancel({ownerId:owner,leaseId,bucketId:bucket,
   path,operation:'create',bytes});
 }
 assert.equal(calls.length,2);
 assert.notEqual(calls[0].args.p_nonce,calls[1].args.p_nonce);
 assert.equal(calls.every(x=>x.name==='v2_cancel_privileged_storage_write_attested_review'),true);
});
