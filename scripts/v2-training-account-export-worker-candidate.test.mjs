import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createTrainingAccountExportWorkerCandidate} from './v2-training-account-export-worker-candidate.mjs';
import {decryptTrainingExportForVerification} from './v2-training-encrypted-export-envelope.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const session='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const path=owner+'/'+'c'.repeat(64)+'/sensor.fit';
const bytes=Buffer.from('simulated owner-only training evidence');
const digest=createHash('sha256').update(bytes).digest('hex');
const token=['eyJhbGciOiJIUzI1NiJ9',
 Buffer.from(JSON.stringify({sub:owner,session_id:session})).toString('base64url'),
 'test-signature'].join('.');
const row=()=>({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 user_id:owner,activity_id:activity,source_id:source,
 object_path:path,checksum_sha256:digest,state:'ready',
 quality:'unverified',encoding:'fit',sample_count:42,
 starts_at:'2026-11-11T12:00:00Z',ends_at:'2026-11-11T12:01:00Z'});
function setup(options={}) {
 const events=[];
 const key=randomBytes(32);
 let envelope=null;
 const authClient={auth:{getUser:async (supplied)=>{
   assert.equal(supplied,token);
   events.push('auth');
   if(options.revokeAfterWrite&&events.filter(x=>x==='auth').length>=3)
     return {error:new Error('revoked')};
   return {data:{user:{id:owner}}};
 }}};
 const data={v2_activity_series:[row()],v2_activity_route_objects:[]};
 const serviceClient={
  rpc:async (name,args)=>{
   assert.equal(name,'v2_account_export_worker_authorize_candidate');
   assert.deepEqual(args,{p_user_id:owner,p_session_id:session,p_request_id:requestId});
   events.push('approvedRequest');
   return options.denyRequest?{error:new Error('cancelled')}:
     {data:{ownerId:owner,sessionId:session,requestId,
       status:'approved',cancelled:false,
       expiresAt:new Date(Date.now()+3600000).toISOString()}};
  },
  from(table){
   return {select:()=> {
     const filters=[];
     const query={
       eq(name,value){filters.push([name,value]);return query;},
       order(){return query;},
       async range(){
         events.push('list');
         return {data:data[table],count:data[table].length,error:null};
       },
       async maybeSingle(){
         events.push('ownerPathProof');
         const matches=(data[table]??[]).filter(x=>
           filters.every(([name,value])=>x[name]===value));
         return {data:matches.length===1?matches[0]:null,error:null};
       },
     };return query;
   }};
  },
  storage:{
   async getBucket(name){
     events.push('bucket');
     return {data:{id:name,public:options.publicBucket??false},error:null};
   },
   from(name){
     assert.equal(name,'v2-private-workout-objects');
     return {async download(objectPath){
       assert.equal(objectPath,path);
       events.push('download');
       return {data:new Blob([options.corrupt?Buffer.from('wrong'):bytes]),error:null};
     }};
   },
  },
 };
 let purges=0;
 const worker=createTrainingAccountExportWorkerCandidate({
   bearerToken:token,authClient,serviceClient,
   resolveEncryptionKey:async()=>key,
   persistPrivateEnvelope:async payload=>{
     events.push('archiveWrite');
     envelope=payload.envelope;
     return {ownerId:owner,requestId,archiveId:'internal-archive',
       encrypted:true,private:true,
       expiresAt:new Date(Date.now()+3600000).toISOString()};
   },
   deletePrivateRequest:async ({ownerId,requestId:request})=>{
     assert.equal(ownerId,owner);assert.equal(request,requestId);
     events.push('purge');purges++;return true;
   },
 });
 return {worker,events,key,get envelope(){return envelope;},
   get purges(){return purges;}};
}
test('end-to-end disabled worker binds live owner request and encrypts checked Storage bytes',async()=>{
 const f=setup();
 const result=await f.worker.stageApprovedRequest(requestId);
 assert.equal(result.archiveId,'internal-archive');
 assert.equal(result.archiveStaged,true);
 assert.equal(result.completeUserExport,false);
 assert.equal(result.storageAuthorizationVerified,false);
 assert.equal(result.verifiedFileCount,1);
 assert.equal(f.events.filter(x=>x==='auth').length,3);
 assert.equal(f.events.filter(x=>x==='approvedRequest').length,3);
 assert.equal(f.events.filter(x=>x==='ownerPathProof').length,1);
 assert.equal(f.events.filter(x=>x==='archiveWrite').length,1);
 assert.equal(f.purges,0);
 assert.equal(JSON.stringify(result).includes(bytes.toString()),false);
 const unsealed=decryptTrainingExportForVerification(f.envelope,f.key,owner,requestId);
 assert.equal(Buffer.from(unsealed.files[0].bytes,'base64').toString(),bytes.toString());
});
test('missing approved owner request aborts before any Storage access',async()=>{
 const f=setup({denyRequest:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/approved export request/);
 assert.equal(f.events.some(x=>x==='download'),false);
 assert.equal(f.events.some(x=>x==='archiveWrite'),false);
});
test('public bucket aborts before downloads',async()=>{
 const f=setup({publicBucket:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/public/);
 assert.equal(f.events.some(x=>x==='download'),false);
});
test('tampered private file aborts without archive creation',async()=>{
 const f=setup({corrupt:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/checksum/);
 assert.equal(f.events.some(x=>x==='archiveWrite'),false);
});
test('revoked session after durable archive write invokes cleanup, no success',async()=>{
 const f=setup({revokeAfterWrite:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/unavailable/);
 assert.equal(f.events.filter(x=>x==='archiveWrite').length,1);
 assert.equal(f.purges,1);
});
