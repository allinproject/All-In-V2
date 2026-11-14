import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {verifyAll251OwnerSession,requireOwnedPrivatePath} from './identity-review.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY'};
const token='test.'+'a'.repeat(64)+'.signature';
const request=(auth='Bearer '+token)=>new Request('https://worker.example/path',{
 headers:auth?{authorization:auth}:{}});
const verified=async()=>new Response(JSON.stringify({id:A}),{
 status:200,headers:{'content-type':'application/json'}});

test('public Worker denies all methods/routes without accessing private R2',async()=>{
 let reads=0,writes=0;
 const binding={get(){reads++;throw Error('R2 touched');},put(){writes++;throw Error('R2 touched');}};
 for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
  for(const path of ['/','/objects/'+A+'/item','/upload','/signed','/multipart']){
   const response=await worker.fetch(new Request('https://worker.example'+path,{method}),
    {PRIVATE_STORAGE:binding});
   assert.equal(response.status,403);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }
 }
 assert.equal(reads,0);assert.equal(writes,0);
});

test('identity guard rejects missing/malformed token without contacting Auth',async()=>{
 for(const auth of ['', 'Basic abc','Bearer x','Bearer '.concat('x'.repeat(5000))]){
  let calls=0;
  await assert.rejects(verifyAll251OwnerSession({
   request:request(auth),env,sessionIsActive:async()=>true,
   fetchImpl:async()=>{calls++;return verified();},
  }),/AUTH_DENIED/);
  assert.equal(calls,0);
 }
});

test('valid Auth user requires independent live session before owner returned',async()=>{
 let calls=0;
 const verifiedOwner=await verifyAll251OwnerSession({
  request:request(),env,sessionIsActive:async({ownerId,accessToken})=>{
   assert.equal(ownerId,A);assert.equal(accessToken,token);return true;},
  fetchImpl:async(url,init)=>{
   calls++;assert.equal(url,env.SUPABASE_URL+'/auth/v1/user');
   assert.equal(init.headers.authorization,'Bearer '+token);
   assert.equal(init.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
   return verified();
  },
 });
 assert.equal(calls,1);
 assert.deepEqual(verifiedOwner,{verifiedOwnerId:A});
});

test('rejected session, impersonation and anonymous user fail closed',async()=>{
 await assert.rejects(verifyAll251OwnerSession({
  request:request(),env,sessionIsActive:async()=>false,fetchImpl:verified,
 }),/AUTH_DENIED/);
 await assert.rejects(verifyAll251OwnerSession({
  request:request(),env,sessionIsActive:async()=>true,
  fetchImpl:async()=>new Response(JSON.stringify({id:A,is_anonymous:true}),{status:200}),
 }),/AUTH_DENIED/);
 await assert.rejects(verifyAll251OwnerSession({
  request:request(),env,sessionIsActive:async()=>true,
  fetchImpl:async()=>new Response(JSON.stringify({id:B}),{status:403}),
 }),/AUTH_DENIED/);
});

test('missing auth backend, lookup failure or missing session authority deny',async()=>{
 for(const config of [{},env]){
  await assert.rejects(verifyAll251OwnerSession({
   request:request(),env:config,fetchImpl:verified,
  }),/AUTH_NOT_CONFIGURED/);
 }
 await assert.rejects(verifyAll251OwnerSession({
  request:request(),env,sessionIsActive:async()=>true,
  fetchImpl:async()=>{throw Error('network error');},
 }),/AUTH_DENIED/);
});

test('owner path enforces exact verified owner and rejects traversal',()=>{
 assert.equal(requireOwnedPrivatePath(A,A+'/photo.bin'),A+'/photo.bin');
 for(const path of [B+'/photo.bin',A+'/../other',A+'/./bad',A+'//bad',A+'/line\nfeed']){
  assert.throws(()=>requireOwnedPrivatePath(A,path),/OWNER_PATH_DENIED/);
 }
});
