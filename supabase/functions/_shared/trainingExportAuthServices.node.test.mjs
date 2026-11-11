import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingExportAuthServices } from './trainingExportAuthServices.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const session='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const future=()=>new Date(Date.now()+3600000).toISOString();
const token=['eyJhbGciOiJIUzI1NiJ9',
 Buffer.from(JSON.stringify({sub:owner,session_id:session})).toString('base64url'),
 'mocked-signature'].join('.');
function fixture(opts={}) {
 let authReads=0,dbReads=0;
 const authClient={auth:{getUser:async got=>{
   authReads++;
   assert.equal(got,opts.token??token);
   return opts.invalidUser?{error:new Error('invalid token')}:
     {data:{user:{id:opts.userId??owner}}};
 }}};
 const serverClient={rpc:async (name,args)=>{
   dbReads++;
   assert.equal(name,'v2_account_export_worker_authorize_candidate');
   assert.equal(args.p_session_id,session);
   assert.equal(args.p_request_id,requestId);
   return opts.invalidSession?{error:new Error('revoked')}:{
     data:Object.prototype.hasOwnProperty.call(opts,'request')?opts.request:
      {ownerId:opts.gateOwner??owner,sessionId:session,requestId,
       status:'approved',cancelled:false,expiresAt:future()},
   };
 }};
 const storageAdapter={listEvidence:async()=>{},downloadPrivateObject:async()=>{}};
 const archiveSink={writeEncryptedArchive:async()=>{},deleteStagedArchive:async()=>{}};
 const services=createTrainingExportAuthServices({
   bearerToken:opts.token??token,authClient,serverClient,storageAdapter,archiveSink,
 });
 return {services,get counts(){return {authReads,dbReads}}};
}
test('requires fresh verified Auth user and exact approved DB request every time',async()=>{
 const f=fixture();
 const a=await f.services.authorizeExport(requestId);
 const b=await f.services.authorizeExport(requestId);
 assert.deepEqual(a,{ownerId:owner,activeSession:true,exportPermitted:true});
 assert.deepEqual(b,a);
 assert.deepEqual(f.counts,{authReads:2,dbReads:2});
});
test('rejects revoked Auth user or session before trusting an export request',async()=>{
 for(const opts of [{invalidUser:true},{invalidSession:true},
  {gateOwner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  {userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]) {
  const f=fixture(opts);
  await assert.rejects(f.services.authorizeExport(requestId),/unavailable|required/);
 }
});
test('rejects missing, cancelled, wrong owner and expired durable export claims',async()=>{
 const invalid=[null,
  {requestId,ownerId:owner,sessionId:session,status:'cancelled',expiresAt:future()},
  {requestId,ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:session,status:'approved',cancelled:false,expiresAt:future()},
  {requestId,ownerId:owner,sessionId:session,status:'approved',cancelled:false,expiresAt:new Date(Date.now()-1000).toISOString()},
  {requestId,ownerId:owner,sessionId:session,status:'approved',cancelled:false,expiresAt:new Date(Date.now()+48*3600000).toISOString()},
  {requestId,ownerId:owner,sessionId:session,status:'approved',cancelled:true,expiresAt:future()},
  {requestId,ownerId:owner,sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'approved',cancelled:false,expiresAt:future()},
 ];
 for(const request of invalid) {
  const f=fixture({request});
  await assert.rejects(f.services.authorizeExport(requestId),/required/);
 }
});
test('rejects malformed JWT, missing signed session claim, and forged request ID',async()=>{
 for(const bad of ['invalid','a.b.c',
  ['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:owner})).toString('base64url'),'signature'].join('.')]) {
   assert.throws(()=>fixture({token:bad}),/Verified session claim/);
 }
 const f=fixture();
 await assert.rejects(f.services.authorizeExport('not-a-request'),/Exact export request/);
 assert.equal(f.counts.authReads,0);
});
test('requires trusted Supabase, Storage and private archive dependencies',()=>{
 assert.throws(()=>createTrainingExportAuthServices({bearerToken:token}),/dependencies/);
});
