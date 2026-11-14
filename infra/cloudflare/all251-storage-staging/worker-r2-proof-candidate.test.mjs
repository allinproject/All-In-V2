import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251R2ProofCandidate} from './worker-r2-proof-candidate.mjs';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const OBJECT='33333333-3333-4333-8333-333333333333';
const LEASE='44444444-4444-4444-8444-444444444444';
const URL='https://allin365-storage-staging.durbenventures.workers.dev/v1/workouts/'+OBJECT;
const JWT='eyJhbGciOiJFUzI1NiJ9.'+'a'.repeat(60)+'.sig';
const data=new TextEncoder().encode('synthetic private R2 bytes');
const key=Buffer.alloc(32,3).toString('base64');
const request=()=>new Request(URL,{method:'POST',
 headers:{authorization:'Bearer '+JWT,'content-type':'application/octet-stream'},
 body:data,
});
function fixture({enabled=true,owner=A,synthetic=true,active=true,
 frozen=false,corrupt=false}={}){
 const stored=new Map(),calls={auth:0,session:0,begin:0,settle:0,put:0,get:0,rpc:0};
 const binding={
  async put(path,bytes,{onlyIf}){
   calls.put++;
   if(onlyIf?.etagDoesNotMatch==='*'&&stored.has(path))return null;
   stored.set(path,{bytes:Uint8Array.from(bytes),etag:'test-etag'});
   return {etag:'test-etag'};
  },
  async get(path){
   calls.get++;
   const object=stored.get(path);if(!object)return null;
   return {arrayBuffer:async()=>{
    const bytes=Uint8Array.from(object.bytes);
    if(corrupt)bytes[0]^=1;
    return bytes.buffer;
   }};
  },
  async head(path){return stored.has(path)?{etag:'test-etag'}:null;},
 };
 const fetchImpl=async(url)=>{
  if(url.endsWith('/auth/v1/user')){
   calls.auth++;
   return new Response(JSON.stringify({id:owner,
    email:'all251-http-test-123@example.invalid',
    app_metadata:{all251_httpmatrix:synthetic}}),{status:200});
  }
  if(url.endsWith('/v2_all251_worker_session_check_review')){
   calls.session++;
   return new Response(active?'true':'false',{status:200});
  }
  throw Error('Unexpected network destination');
 };
 const authority={
  async begin(){calls.begin++;return frozen?
   {data:null,error:{code:'FROZEN'}}:{data:LEASE,error:null};},
  async settle(){calls.settle++;return {data:true,error:null};},
 };
 const candidate=createAll251R2ProofCandidate({
  fetchImpl,
  createRPC:()=>{calls.rpc++;return {rpc:async()=>{throw Error('Unsigned not allowed');}};},
  createAuthority:()=>authority,
 });
 const env={
  ALL251_ENABLE_SYNTHETIC_PROOF:enabled?'synthetic-proof-reviewed':undefined,
  SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY',
  ALL251_WRITER_SIGNER_B64:key,
  PRIVATE_STORAGE:binding,
 };
 return {candidate,env,stored,calls};
}

test('new Worker candidate defaults to deny; no Auth, lease or R2 invocation',async()=>{
 const f=fixture({enabled:false});
 const res=await f.candidate.fetch(request(),f.env);
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{code:'STORAGE_NOT_READY'});
 assert.equal(f.calls.auth+f.calls.begin+f.calls.put+f.calls.get,0);
});

test('synthetic user writes and exact R2 byte readback are lease protected',async()=>{
 const f=fixture();
 const res=await f.candidate.fetch(request(),f.env);
 assert.equal(res.status,201);
 assert.deepEqual(await res.json(),{code:'CREATED'});
 assert.deepEqual(f.stored.get(A+'/'+OBJECT+'.bin').bytes,data);
 assert.deepEqual(f.calls,{auth:2,session:1,begin:1,settle:1,put:1,get:1,rpc:1});
});

test('repeat create cannot overwrite R2 private bytes and leaves unresolved lease',async()=>{
 const f=fixture();
 assert.equal((await f.candidate.fetch(request(),f.env)).status,201);
 const repeat=await f.candidate.fetch(request(),f.env);
 assert.equal(repeat.status,503);
 assert.deepEqual(f.stored.get(A+'/'+OBJECT+'.bin').bytes,data);
 assert.equal(f.calls.begin,2);
 assert.equal(f.calls.settle,1);
});

test('non-synthetic authenticated user cannot touch leases or Storage',async()=>{
 const f=fixture({synthetic:false});
 const res=await f.candidate.fetch(request(),f.env);
 assert.equal(res.status,403);
 assert.equal(f.calls.session,0);assert.equal(f.calls.put,0);
});

test('revoked session cannot read upload body, begin lease or touch R2',async()=>{
 const f=fixture({active:false});
 const res=await f.candidate.fetch(request(),f.env);
 assert.equal(res.status,401);
 assert.equal(f.calls.begin,0);assert.equal(f.calls.put,0);
});

test('A frozen after requesting deletion cannot write; B can continue',async()=>{
 const a=fixture({owner:A,frozen:true});
 const denied=await a.candidate.fetch(request(),a.env);
 assert.equal(denied.status,503);
 assert.equal(a.calls.put,0);
 const b=fixture({owner:B});
 assert.equal((await b.candidate.fetch(request(),b.env)).status,201);
 assert.equal(b.calls.settle,1);
 assert.deepEqual(b.stored.get(B+'/'+OBJECT+'.bin').bytes,data);
});

test('byte mismatch does not settle the previously acquired lease',async()=>{
 const f=fixture({corrupt:true});
 assert.equal((await f.candidate.fetch(request(),f.env)).status,503);
 assert.equal(f.calls.begin,1);
 assert.equal(f.calls.put,1);
 assert.equal(f.calls.settle,0);
});

test('missing or incorrect signer, binding, configuration deny without a write',async()=>{
 for(const property of ['ALL251_WRITER_SIGNER_B64','PRIVATE_STORAGE','SUPABASE_PUBLISHABLE_KEY']){
  const f=fixture();
  delete f.env[property];
  assert.equal((await f.candidate.fetch(request(),f.env)).status,403);
  assert.equal(f.calls.put,0);
 }
});

test('default test Worker remains deny-only, not the proof candidate',async()=>{
 const worker=(await import('./worker.mjs')).default;
 const f=fixture();
 const res=await worker.fetch(request(),f.env);
 assert.equal(res.status,403);
 assert.equal(f.calls.put,0);
});
