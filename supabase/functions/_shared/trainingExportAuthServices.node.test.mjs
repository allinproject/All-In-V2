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
 let authReads=0,dbReads=0,requests=0;
 const authClient={auth:{getUser:async got=>{
   authReads++;
   if(got!==token)throw new Error('Token changed');
   return opts.invalidUser?{error:new Error('invalid token')}:
     {data:{user:{id:opts.userId??owner}}};
 }}};
 const serverClient={schema:namespace=>{
   assert.equal(namespace,'allin_private');
   return {rpc:async (name,args)=>{
     dbReads++;
     assert.equal(name,'v2_account_export_authorize_session_candidate');
     assert.equal(args.p_session_id,session);
     return opts.invalidSession ? {error:new Error('revoked')}:
       {data:{ownerId:opts.gateOwner??owner,sessionId:session,
         activeSession:true,exportPermitted:true,completeUserExport:false}};
   }};
 }};
 const storageAdapter={listEvidence:async()=>{},downloadPrivateObject:async()=>{}};
 const archiveSink={writeEncryptedArchive:async()=>{},deleteStagedArchive:async()=>{}};
 const services=createTrainingExportAuthServices({
   bearerToken:opts.token??token,authClient,serverClient,storageAdapter,archiveSink,
   authorizeDurableRequest:async request=>{
     requests++;
     return opts.request??{requestId,ownerId:owner,status:'approved',
       expiresAt:future(),cancelled:false};
   },
 });
 return {services,get counts(){return {authReads,dbReads,requests}}};
}
test('accepts exact session and approved durable owner request; rechecks every time',async()=>{
 const f=fixture();
 const a=await f.services.authorizeExport(requestId);
 const b=await f.services.authorizeExport(requestId);
 assert.deepEqual(a,{ownerId:owner,activeSession:true,exportPermitted:true});
 assert.deepEqual(b,a);
 assert.deepEqual(f.counts,{authReads:2,dbReads:2,requests:2});
});
test('rejects revoked token or server-validated session without reaching request',async()=>{
 for(const opts of [{invalidUser:true},{invalidSession:true},
  {gateOwner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  {userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]) {
   const f=fixture(opts);
   await assert.rejects(f.services.authorizeExport(requestId),/unavailable|not authorized/);
   assert.equal(f.counts.requests,0);
 }
});
test('rejects missing, cancelled, wrong owner and expired durable export claims',async()=>{
 const invalid=[
  null,
  {requestId,ownerId:owner,status:'cancelled',expiresAt:future()},
  {requestId,ownerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'approved',expiresAt:future()},
  {requestId,ownerId:owner,status:'approved',expiresAt:new Date(Date.now()-1000).toISOString()},
  {requestId,ownerId:owner,status:'approved',expiresAt:new Date(Date.now()+48*3600000).toISOString()},
  {requestId,ownerId:owner,status:'approved',expiresAt:future(),cancelled:true},
 ];
 for(const request of invalid) {
  const f=fixture({request});
  await assert.rejects(f.services.authorizeExport(requestId),/request missing/);
 }
});
test('rejects malformed JWT, missing signed session claim and forged request ID',async()=>{
 for(const bad of ['invalid','a.b.c',
  ['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:owner})).toString('base64url'),'signature'].join('.')]) {
  assert.throws(()=>fixture({token:bad}),/Verified session claim/);
 }
 const f=fixture();
 await assert.rejects(f.services.authorizeExport('not-a-request'),/Exact export request/);
 assert.equal(f.counts.authReads,0);
});
test('requires trusted Storage, archive and durable-request dependencies',()=>{
 assert.throws(()=>createTrainingExportAuthServices({bearerToken:token}),/dependencies/);
});
