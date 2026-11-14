import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251AttestedRpcReview} from './attested-rpc-review.mjs';
const env={
 SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
 ALL251_STAGING_PRIVILEGED_KEY:'sb_secret_'+'x'.repeat(30),
};
const begin={
 p_owner_id:'11111111-1111-4111-8111-111111111111',
 p_bucket_id:'v2-private-workout-objects',
 p_object_path:'11111111-1111-4111-8111-111111111111/a.bin',
 p_operation:'create',
 p_sha256:'a'.repeat(64),
 p_nonce:'22222222-2222-4222-8222-222222222222',
 p_issued_epoch:1794580000,
 p_signature:'b'.repeat(64),
};
const settle={
 p_owner_id:begin.p_owner_id,p_lease_id:'33333333-3333-4333-8333-333333333333',
 p_nonce:'44444444-4444-4444-8444-444444444444',
 p_issued_epoch:begin.p_issued_epoch,p_signature:begin.p_signature,
};
test('no signer or privileged key means client cannot be constructed',()=>{
 for(const bad of [{},{...env,ALL251_STAGING_PRIVILEGED_KEY:'invalid'},
   {...env,SUPABASE_URL:'https://another.supabase.co'}]){
  assert.throws(()=>createAll251AttestedRpcReview({env:bad}),/NOT_CONFIGURED/);
 }
});
test('only the two attested RPCs and exact argument names are accepted',async()=>{
 let calls=0;
 const rpc=createAll251AttestedRpcReview({env,fetchImpl:async()=>{
  calls++;return new Response('true',{status:200});
 }});
 for(const [name,args] of [
  ['v2_begin_privileged_storage_write_review',begin],
  ['v2_settle_privileged_storage_write_review',settle],
  ['v2_begin_privileged_storage_write_attested_review',{...begin,owner_id:begin.p_owner_id}],
  ['v2_settle_privileged_storage_write_attested_review',{...settle,p_extra:true}],
 ]){
  const response=await rpc.rpc(name,args);
  assert.equal(response.error.code,'RPC_SCOPE_DENIED');
 }
 assert.equal(calls,0);
});
test('attested begin/settle requests use privileged key only inside HTTPS backend',async()=>{
 const calls=[];
 const rpc=createAll251AttestedRpcReview({env,fetchImpl:async(url,init)=>{
  calls.push({url,init});
  return new Response(url.endsWith('begin_privileged_storage_write_attested_review')?
   JSON.stringify('33333333-3333-4333-8333-333333333333'):'true',{status:200});
 }});
 const b=await rpc.rpc('v2_begin_privileged_storage_write_attested_review',begin);
 const s=await rpc.rpc('v2_settle_privileged_storage_write_attested_review',settle);
 assert.equal(b.error,null);assert.equal(s.data,true);
 assert.equal(calls.length,2);
 for(const {url,init} of calls){
  assert(url.startsWith(env.SUPABASE_URL+'/rest/v1/rpc/v2_'));
  assert.equal(init.method,'POST');
  assert.equal(init.headers.apikey,env.ALL251_STAGING_PRIVILEGED_KEY);
  assert.equal(init.headers.authorization,'Bearer '+env.ALL251_STAGING_PRIVILEGED_KEY);
 }
});
test('HTTP, JSON, transport failures never reveal privileged headers',async()=>{
 for(const fetchImpl of [
  async()=>new Response('unauthorized',{status:403}),
  async()=>new Response('not-json',{status:200}),
  async()=>new Response(JSON.stringify({secret:env.ALL251_STAGING_PRIVILEGED_KEY}),{status:200}),
  async()=>{throw Error(env.ALL251_STAGING_PRIVILEGED_KEY);},
 ]){
  const rpc=createAll251AttestedRpcReview({env,fetchImpl});
  const response=await rpc.rpc('v2_begin_privileged_storage_write_attested_review',begin);
  assert.deepEqual(response,{data:null,error:{code:'RPC_UNVERIFIED'}});
  assert(!JSON.stringify(response).includes(env.ALL251_STAGING_PRIVILEGED_KEY));
 }
});
