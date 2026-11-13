import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivilegedStorageWriter,MAX_PRIVILEGED_STORAGE_BYTES} from './trainingPrivilegedStorageWriter.mjs';
const owner='a8111111-8111-4111-8111-811111111111';
const other='b8222222-8222-4222-8222-822222222222';
const leaseId='c8333333-8333-4333-8333-833333333333';
const path=owner+'/sensor.fit',bucketId='v2-private-workout-objects';
const bytes=new Uint8Array([1,2,3,4]);
function fixture(changes={}){
 const calls=[],state={};
 const store={
  upload:async(p,data,options)=>{
   calls.push(['upload',p,options]);return {data:{path:p},error:null};
  },
  update:async(p,data,options)=>{
   calls.push(['update',p,options]);return {data:{path:p},error:null};
  },
  download:async(p)=>{
   calls.push(['download',p]);return {data:{arrayBuffer:async()=>bytes.buffer},error:null};
  },
  ...changes.store,
 };
 const supabase={
  rpc:async(name,args)=>{
   calls.push([name,args]);
   return name==='v2_begin_privileged_storage_write_review'
    ? {data:leaseId,error:null}:{data:true,error:null};
  },
  storage:{from:id=>{calls.push(['bucket',id]);return store;}},
 };
 if(changes.rpc)supabase.rpc=async(name,args)=>{
  calls.push([name,args]);return changes.rpc(name,args);
 };
 const writer=createPrivilegedStorageWriter({supabase});
 const write=(extra={})=>writer.write({
  verifiedOwnerId:owner,bucketId,path,bytes,operation:'create',
  contentType:'application/octet-stream',...extra,
 });
 return {calls,write};
}
test('creates durable lease first, reads matching private bytes, settles last',async()=>{
 const f=fixture();
 assert.deepEqual(await f.write(),{bucketId,path,verified:true});
 assert.deepEqual(f.calls.map(c=>c[0]),[
  'v2_begin_privileged_storage_write_review','bucket','upload','download',
  'v2_settle_privileged_storage_write_review']);
 assert.deepEqual(f.calls[0][1],{p_owner_id:owner,p_bucket_id:bucketId,
  p_object_path:path,p_operation:'create'});
 assert.deepEqual(f.calls[4][1],{p_owner_id:owner,p_lease_id:leaseId});
 assert.equal(f.calls[2][2].upsert,false);
});
test('replacement is routed through the same lease and readback',async()=>{
 const f=fixture();
 assert.deepEqual(await f.write({operation:'replace'}),{bucketId,path,verified:true});
 assert.equal(f.calls[2][0],'update');
 assert.equal(f.calls.at(-1)[0],'v2_settle_privileged_storage_write_review');
});
test('timeouts, missing response, mismatch and settlement uncertainty never release a lease',async()=>{
 const scenarios=[
  {store:{upload:async()=>{throw Error('lost upload response');}}},
  {store:{upload:async()=>({error:{message:'ambiguous'},data:null})}},
  {store:{upload:async()=>({data:{path:'incorrect'},error:null})}},
  {store:{download:async()=>({data:null,error:{message:'timeout'}})}},
  {store:{download:async()=>({data:{arrayBuffer:async()=>
   new Uint8Array([1,2,3,9]).buffer},error:null})}},
  {rpc:async name=>name==='v2_begin_privileged_storage_write_review'
   ? {data:leaseId,error:null}:{data:false,error:null}},
 ];
 for(const changes of scenarios){
  const f=fixture(changes);
  await assert.rejects(f.write());
  if(f.calls.some(c=>c[0]==='v2_settle_privileged_storage_write_review')){
   assert.equal(changes.rpc!==undefined,true,
    'Only the explicit settlement failure scenario may invoke settlement');
  }
 }
});
test('lease must exist before Storage request and may not be a boolean',async()=>{
 for(const result of [{data:null,error:{message:'denied'}},{data:true,error:null}]){
  const f=fixture({rpc:async()=>result});
  await assert.rejects(f.write(),/lease unavailable/);
  assert.deepEqual(f.calls.map(c=>c[0]),['v2_begin_privileged_storage_write_review']);
 }
});
test('no credentialed write for arbitrary paths, buckets, owners, operations or sizes',async()=>{
 const f=fixture();
 const cases=[
  {verifiedOwnerId:other},
  {path:'../sensor.fit'},
  {path:owner+'/../cross-account.fit'},
  {bucketId:'public-avatars'},
  {operation:'remove'},
  {bytes:new Uint8Array(0)},
  {bytes:new Uint8Array(MAX_PRIVILEGED_STORAGE_BYTES+1)},
  {contentType:'\r\nInjected: yes'},
 ];
 for(const input of cases)await assert.rejects(f.write(input),/Invalid scoped/);
 assert.equal(f.calls.length,0);
});

test('existing durable lease also fences canonical export custom HTTP upload callback',async()=>{
 const calls=[],bytes=new Uint8Array([1,2,3,4]);
 const client={
  rpc:async(name,args)=>{
   calls.push(name);
   return name==='v2_begin_privileged_storage_write_review'
    ? {data:leaseId,error:null}:{data:true,error:null};
  },
  storage:{from:()=>({
   download:async()=>{calls.push('readback');return {
    data:{arrayBuffer:async()=>bytes.buffer},error:null,
   };},
  })},
 };
 const writer=createPrivilegedStorageWriter({supabase:client});
 const result=await writer.writeWithBarrier({
   verifiedOwnerId:owner,bucketId,path,bytes,
   operation:'create',contentType:'application/octet-stream',
   upload:async()=>{calls.push('archiveUpload');return {data:{path},error:null};},
 });
 assert.equal(result.verified,true);
 assert.deepEqual(calls,['v2_begin_privileged_storage_write_review',
  'archiveUpload','readback','v2_settle_privileged_storage_write_review']);
 assert.throws(()=>writer.writeWithBarrier({
   verifiedOwnerId:owner,bucketId,path,bytes,
   operation:'create',contentType:'application/octet-stream',
 }),/upload callback required/);
});
