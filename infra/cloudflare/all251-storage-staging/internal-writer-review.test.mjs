import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251InternalWriterReview} from './internal-writer-review.mjs';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const LEASE='33333333-3333-4333-8333-333333333333';
const jwt='eyJhbGciOiJFUzI1NiJ9.'+'a'.repeat(60)+'.sig';
const env={
 SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY',
};
const bytes=()=>new TextEncoder().encode('isolated synthetic workout');
const request=()=>new Request('https://worker.example/write',{
 headers:{authorization:'Bearer '+jwt}});

function fixture({owner=A,active=true,frozen=false,corrupt=false}={}){
 const objects=new Map(),stats={auth:0,session:0,lease:0,put:0,settle:0};
 const binding={
  async put(path,data,{onlyIf}={}){
   stats.put++;
   if(onlyIf?.etagDoesNotMatch==='*'&&objects.has(path))return null;
   const record={etag:'tag-'+stats.put,bytes:Uint8Array.from(data)};
   objects.set(path,record);
   return {etag:record.etag};
  },
  async get(path){
   const stored=objects.get(path);
   if(!stored)return null;
   return {arrayBuffer:async()=>{
    const value=Uint8Array.from(stored.bytes);
    if(corrupt)value[0]^=1;
    return value.buffer;
   }};
  },
  async head(path){
   const stored=objects.get(path);
   return stored?{etag:stored.etag}:null;
  },
 };
 const fetchImpl=async(url)=>{
  if(url.endsWith('/auth/v1/user')){
   stats.auth++;
   return new Response(JSON.stringify({id:owner}),{status:200});
  }
  if(url.endsWith('/v2_all251_worker_session_check_review')){
   stats.session++;
   return new Response(JSON.stringify(active),{status:active?200:403});
  }
  throw Error('Unexpected endpoint');
 };
 const attestedLeaseAuthority={
  async begin(){
   stats.lease++;
   return frozen?{data:null,error:{code:'FROZEN'}}:
    {data:LEASE,error:null};
  },
  async settle(){stats.settle++;return {data:true,error:null};},
 };
 const writer=createAll251InternalWriterReview({
  env,fetchImpl,binding,attestedLeaseAuthority,
 });
 return {writer,objects,stats};
}

test('active owner session acquires lease, writes exact bytes and settles',async()=>{
 const f=fixture();
 const receipt=await f.writer.writeFromVerifiedRequest({
  request:request(),path:A+'/fixture.bin',bytes:bytes(),
 });
 assert.equal(receipt.verified,true);
 assert.deepEqual(f.stats,{auth:1,session:1,lease:1,put:1,settle:1});
 assert.deepEqual(f.objects.get(A+'/fixture.bin').bytes,bytes());
});

test('missing approved attested lease authority prevents construction',()=>{
 const f=fixture();
 assert.throws(()=>createAll251InternalWriterReview({
  env,fetchImpl:async()=>new Response('{}'),binding:{
   put:async()=>{},head:async()=>{},get:async()=>{},
  },attestedLeaseAuthority:null,
 }),/ATTESTED_LEASE_REQUIRED/);
 assert.equal(f.stats.put,0);
});

test('revoked Auth session never reaches lease or R2',async()=>{
 const f=fixture({active:false});
 await assert.rejects(f.writer.writeFromVerifiedRequest({
  request:request(),path:A+'/revoked.bin',bytes:bytes(),
 }),/AUTH_DENIED/);
 assert.deepEqual(f.stats,{auth:1,session:1,lease:0,put:0,settle:0});
 assert.equal(f.objects.size,0);
});

test('cross-owner private file path rejected before lease or upload',async()=>{
 const f=fixture({owner:A});
 await assert.rejects(f.writer.writeFromVerifiedRequest({
  request:request(),path:B+'/foreign.bin',bytes:bytes(),
 }),/OWNER_PATH_DENIED/);
 assert.deepEqual(f.stats,{auth:1,session:1,lease:0,put:0,settle:0});
});

test('deletion freeze rejects A but B remains independently writable',async()=>{
 const a=fixture({owner:A,frozen:true});
 await assert.rejects(a.writer.writeFromVerifiedRequest({
  request:request(),path:A+'/late.bin',bytes:bytes(),
 }),/lease unavailable/);
 assert.equal(a.stats.put,0);
 assert.equal(a.stats.settle,0);
 const b=fixture({owner:B});
 const receipt=await b.writer.writeFromVerifiedRequest({
  request:request(),path:B+'/independent.bin',bytes:bytes(),
 });
 assert.equal(receipt.verified,true);
 assert.equal(b.stats.settle,1);
});

test('byte mismatch retains unresolved lease and never settles',async()=>{
 const f=fixture({corrupt:true});
 await assert.rejects(f.writer.writeFromVerifiedRequest({
  request:request(),path:A+'/mismatch.bin',bytes:bytes(),
 }),/bytes differ/);
 assert.equal(f.stats.lease,1);
 assert.equal(f.stats.put,1);
 assert.equal(f.stats.settle,0);
});

test('missing or invalid identity cannot grant session or write',async()=>{
 const f=fixture();
 await assert.rejects(f.writer.writeFromVerifiedRequest({
  request:new Request('https://worker.example/write'),
  path:A+'/missing.bin',bytes:bytes(),
 }),/AUTH_DENIED/);
 assert.deepEqual(f.stats,{auth:0,session:0,lease:0,put:0,settle:0});
});
