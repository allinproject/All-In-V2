import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,createHash} from 'node:crypto';
import {createPrivilegedStorageWriter}
 from './trainingPrivilegedStorageWriter.mjs';
import {createAttestedPrivilegedStorageLeaseAuthority}
 from './trainingPrivilegedStorageLeaseAttestation.mjs';
const owner='a8111111-a811-4111-8111-a81111111111';
const foreign='b8222222-b822-4222-8222-b82222222222';
const nonce='c8333333-c833-4333-8333-c83333333333';
const lease='d8444444-d844-4444-8444-d84444444444';
const bucketId='v2-private-workout-objects';
const path=owner+'/series.fit';
const data=new Uint8Array(Buffer.from('private owner-scoped time series bytes'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function harness({wrongReadback=false,failUpload=false,badKey=false}={}){
 const secret=randomBytes(32),calls=[],store=new Map();
 const signature=(parts)=>createHmac('sha256',secret).update(parts.join('\n')).digest('hex');
 const supabase={
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='v2_begin_attested_privileged_storage_write_review'){
    assert.equal(args.p_owner,owner);
    assert.equal(args.p_bucket,bucketId);
    assert.equal(args.p_sha256,digest(data));
    assert.equal(args.p_mac,signature([
     'all251-begin-v1',args.p_owner,args.p_bucket,args.p_path,args.p_operation,
     args.p_sha256,args.p_nonce,String(args.p_expires_epoch),String(args.p_key_version)
    ]));
    return {data:lease,error:null};
   }
   if(name==='v2_settle_attested_privileged_storage_write_review'){
    assert.equal(args.p_owner,owner);
    assert.equal(args.p_lease,lease);
    assert.equal(args.p_mac,signature([
     'all251-settle-v1',owner,lease,nonce,digest(data),
     String(args.p_expires_epoch),'1'
    ]));
    return {data:true,error:null};
   }
   throw Error('Legacy unsigned RPC attempted: '+name);
  },
  storage:{from:(bucket)=>{
   assert.equal(bucket,bucketId);
   return {
    upload:async(p,bytes)=>{
     if(failUpload)throw Error('ambiguous network timeout');
     store.set(p,new Uint8Array(bytes));return {data:{path:p},error:null};
    },
    download:async(p)=>({data:{arrayBuffer:async()=>{
     const bytes=store.get(p);
     return wrongReadback?Buffer.from('wrong'):Buffer.from(bytes);
    }},error:null}),
   };
  }},
 };
 const leaseAuthority=createAttestedPrivilegedStorageLeaseAuthority({
  supabase,getSigningKey:async()=>badKey?new Uint8Array(12):secret,
  now:()=>1763050000000,newNonce:()=>nonce
 });
 const writer=createPrivilegedStorageWriter({supabase,leaseAuthority});
 return {writer,calls,store};
}
test('attested canonical writer signs byte-bound lease, reads exact bytes, settles once',async()=>{
 const t=harness();
 const done=await t.writer.write({verifiedOwnerId:owner,bucketId,path,bytes:data,
  operation:'create',contentType:'application/octet-stream'});
 assert.equal(done.verified,true);
 assert.deepEqual(t.calls.map(x=>x.name),[
  'v2_begin_attested_privileged_storage_write_review',
  'v2_settle_attested_privileged_storage_write_review']);
 assert.deepEqual(t.store.get(path),data);
 assert(t.calls.every(x=>!Object.hasOwn(x.args,'signingKey')));
});
test('missing independent writer key never invokes lease RPC or writes bytes',async()=>{
 const t=harness({badKey:true});
 await assert.rejects(t.writer.write({verifiedOwnerId:owner,bucketId,path,bytes:data,
  operation:'create',contentType:'application/octet-stream'}),/signing key/);
 assert.equal(t.calls.length,0);assert.equal(t.store.size,0);
});
test('ambiguous provider upload leaves an unresolved durable lease, never settles',async()=>{
 const t=harness({failUpload:true});
 await assert.rejects(t.writer.write({verifiedOwnerId:owner,bucketId,path,bytes:data,
  operation:'create',contentType:'application/octet-stream'}),/timeout/);
 assert.deepEqual(t.calls.map(x=>x.name),['v2_begin_attested_privileged_storage_write_review']);
});
test('byte mismatch cannot settle a lease even when provider reports success',async()=>{
 const t=harness({wrongReadback:true});
 await assert.rejects(t.writer.write({verifiedOwnerId:owner,bucketId,path,bytes:data,
  operation:'create',contentType:'application/octet-stream'}),/bytes differ/);
 assert.equal(t.calls.filter(x=>x.name.includes('settle')).length,0);
});
test('wrong owner path fails before signing or RPC',async()=>{
 const t=harness();
 await assert.rejects(t.writer.write({verifiedOwnerId:foreign,bucketId,path,bytes:data,
  operation:'create',contentType:'application/octet-stream'}),/Invalid scoped/);
 assert.equal(t.calls.length,0);
});
