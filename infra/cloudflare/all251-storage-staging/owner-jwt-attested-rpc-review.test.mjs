import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251OwnerJwtAttestedRpcReview}
 from './owner-jwt-attested-rpc-review.mjs';
const TOKEN='eyJhbGciOiJFUzI1NiJ9.'+'a'.repeat(70)+'.signature';
const ENV={SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY'};
const OWNER='11111111-1111-4111-8111-111111111111';
const LEASE='22222222-2222-4222-8222-222222222222';
const begin={
 p_owner_id:OWNER,p_bucket_id:'v2-private-workout-objects',
 p_object_path:OWNER+'/file.bin',p_operation:'create',p_sha256:'a'.repeat(64),
 p_nonce:'33333333-3333-4333-8333-333333333333',
 p_issued_epoch:1794580000,p_signature:'b'.repeat(64),
};
const settle={p_owner_id:OWNER,p_lease_id:LEASE,
 p_nonce:'44444444-4444-4444-8444-444444444444',
 p_issued_epoch:1794580000,p_signature:'c'.repeat(64)};
test('only owner JWT + publishable key, no privileged key, is sent to narrow RPCs',async()=>{
 const calls=[];
 const rpc=createAll251OwnerJwtAttestedRpcReview({
  env:ENV,accessToken:TOKEN,
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   return new Response(JSON.stringify(url.includes('begin')?LEASE:true),{status:200});
  },
 });
 assert.deepEqual(await rpc.rpc('v2_begin_privileged_storage_write_attested_review',begin),
  {data:LEASE,error:null});
 assert.deepEqual(await rpc.rpc('v2_settle_privileged_storage_write_attested_review',settle),
  {data:true,error:null});
 assert.equal(calls.length,2);
 assert(calls[0].url.endsWith('/v2_all251_owner_attested_begin_review'));
 assert(calls[1].url.endsWith('/v2_all251_owner_attested_settle_review'));
 for(const {init} of calls){
  assert.equal(init.headers.apikey,ENV.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(init.headers.authorization,'Bearer '+TOKEN);
  assert(!JSON.stringify(init).includes('sb_secret_'));
  assert(!JSON.stringify(init).includes('service_role'));
 }
});
test('unsigned routes, malformed arguments and extra keys rejected pre-network',async()=>{
 let calls=0;
 const rpc=createAll251OwnerJwtAttestedRpcReview({
  env:ENV,accessToken:TOKEN,fetchImpl:async()=>{calls++;return new Response('true');},
 });
 for(const [name,args] of [
  ['v2_begin_privileged_storage_write_review',begin],
  ['v2_settle_privileged_storage_write_review',settle],
  ['v2_begin_privileged_storage_write_attested_review',{...begin,p_extra:123}],
  ['v2_settle_privileged_storage_write_attested_review',{...settle,p_extra:123}],
  ['other_function',{}],
 ]){
  assert.equal((await rpc.rpc(name,args)).error.code,'ATTESTED_SCOPE_DENIED');
 }
 assert.equal(calls,0);
});
test('wrong response, denied session, missing RPC and network errors fail closed',async()=>{
 for(const scenario of [
  async()=>new Response(JSON.stringify(true),{status:403}),
  async()=>new Response(JSON.stringify(LEASE),{status:404}),
  async()=>new Response(JSON.stringify({id:LEASE}),{status:200}),
  async()=>{throw Error('token '+TOKEN);},
 ]){
  const rpc=createAll251OwnerJwtAttestedRpcReview({
   env:ENV,accessToken:TOKEN,fetchImpl:scenario,
  });
  const actual=await rpc.rpc('v2_begin_privileged_storage_write_attested_review',begin);
  assert.deepEqual(actual,{data:null,error:{code:'ATTESTED_UNVERIFIED'}});
  assert(!JSON.stringify(actual).includes(TOKEN));
 }
});
test('no session JWT, publishable key or approved origin blocks construction',()=>{
 for(const args of [
  {env:ENV,accessToken:'short'},
  {env:{...ENV,SUPABASE_PUBLISHABLE_KEY:''},accessToken:TOKEN},
  {env:{...ENV,SUPABASE_URL:'https://wrong.supabase.co'},accessToken:TOKEN},
 ]){
  assert.throws(()=>createAll251OwnerJwtAttestedRpcReview(args),
   /OWNER_JWT_ATTESTATION_NOT_CONFIGURED/);
 }
});
