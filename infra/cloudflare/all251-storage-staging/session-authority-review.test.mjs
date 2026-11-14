import test from 'node:test';
import assert from 'node:assert/strict';
import {createAll251SessionAuthority} from './session-authority-review.mjs';
import {verifyAll251OwnerSession} from './identity-review.mjs';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const env={
 SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY',
};
const jwt='eyJhbGciOiJFUzI1NiJ9.'+'x'.repeat(60)+'.sig';
const input={ownerId:A,accessToken:jwt};
const req=()=>new Request('https://worker.example/staging',{headers:{authorization:'Bearer '+jwt}});
const result=(status,body)=>new Response(status===204?null:JSON.stringify(body),{status});
function authority(response){
 return createAll251SessionAuthority({env,fetchImpl:async()=>response});
}

test('session authority permits only exact 200 boolean true',async()=>{
 assert.equal(await authority(result(200,true))(input),true);
 for(const body of [false,null,'true',{},[],{activeSession:true}]){
  assert.equal(await authority(result(200,body))(input),false);
 }
 for(const status of [201,204,302,400,401,403,404,409,429,500]){
  assert.equal(await authority(result(status,true))(input),false);
 }
});

test('revoked session and absent deployed RPC remain denied',async()=>{
 const revoked=authority(result(403,{code:'42501'}));
 const absent=authority(result(404,{code:'PGRST202'}));
 assert.equal(await revoked(input),false);
 assert.equal(await absent(input),false);
});

test('RPC client sends user JWT and publishable key, no elevated credentials',async()=>{
 let calls=0;
 const check=createAll251SessionAuthority({env,fetchImpl:async(url,options)=>{
  calls++;
  assert.equal(url,env.SUPABASE_URL+'/rest/v1/rpc/v2_all251_worker_session_check_review');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers.authorization,'Bearer '+jwt);
  assert.equal(options.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(options.body,'{}');
  assert(!options.body.includes(A));
  return result(200,true);
 }});
 assert.equal(await check(input),true);
 assert.equal(calls,1);
});

test('request cannot submit owner identity or impersonate another account',async()=>{
 let calls=0;
 const guard=createAll251SessionAuthority({env,fetchImpl:async()=>{
  calls++;return result(200,true);
 }});
 assert.equal(await guard({ownerId:'not-a-uuid',accessToken:jwt}),false);
 assert.equal(await guard({ownerId:B,accessToken:'bad'}),false);
 assert.equal(calls,0);
});

test('network error and invalid JSON fail closed',async()=>{
 const broken=createAll251SessionAuthority({env,fetchImpl:async()=>{throw Error('network');}});
 assert.equal(await broken(input),false);
 const malformed=createAll251SessionAuthority({env,fetchImpl:async()=>new Response('not json',{status:200})});
 assert.equal(await malformed(input),false);
});

test('integrated identity guard denies stale session after verified Auth user',async()=>{
 const fetchImpl=async(url)=>{
  if(url.endsWith('/auth/v1/user'))return result(200,{id:A});
  if(url.endsWith('v2_all251_worker_session_check_review'))return result(403,{code:'42501'});
  throw Error('Unexpected request');
 };
 const active=createAll251SessionAuthority({env,fetchImpl});
 await assert.rejects(
  verifyAll251OwnerSession({request:req(),env,sessionIsActive:active,fetchImpl}),
  /AUTH_DENIED/,
 );
});

test('missing project configuration never reaches identity provider',()=>{
 assert.throws(()=>createAll251SessionAuthority({env:{}}),/NOT_CONFIGURED/);
 assert.throws(()=>createAll251SessionAuthority({env:{...env,SUPABASE_URL:'https://evil.example'}}),
  /NOT_CONFIGURED/);
});
