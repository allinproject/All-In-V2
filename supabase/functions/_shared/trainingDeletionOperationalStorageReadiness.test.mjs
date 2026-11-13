import assert from 'node:assert/strict';
import test from 'node:test';
import {createOperationalStorageReadiness} from './trainingDeletionOperationalStorageReadiness.mjs';
import {executeDeletionOnce} from '../v2-account-deletion-worker/execution.ts';

const user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
const request_id='cccccccc-cccc-4ccc-8ccc-cccccccc0251';
const request={user_id,request_id};
const ready={ownerId:user_id,requestId:request_id,
 completePrivateStorage:true,durableCheckpointVerified:true,
 uploadBarrierEnforced:true};
function adapter(response){
 const calls=[];
 const client={rpc:async(name,params)=>{calls.push({name,params});return response;}};
 return {verifyStorageReadiness:createOperationalStorageReadiness({supabase:client}).verifyStorageReadiness,calls};
}
test('operational worker reads exact durable DB attestation before Auth deletion',async()=>{
 const {verifyStorageReadiness,calls}=adapter({data:ready,error:null});
 const services={
  claim:async()=>({data:{status:'processing',user_id,request_id}}),
  verifyStorageReadiness,
  deleteAuthUser:async()=>({}),
  inspectAuthUser:async()=>({error:{status:404,code:'user_not_found'}}),
  complete:async()=>({data:{status:'completed',request_id}}),
  verifyCompletion:async()=>({error:{code:'unexpected'}}),
  recordFailure:async()=>({}),
 };
 assert.equal(await executeDeletionOnce(request,services),'completed');
 assert.deepEqual(calls,[{name:'v2_verify_account_deletion_storage_readiness',
  params:{p_expected_user_id:user_id,p_expected_request_id:request_id}}]);
});
test('no deployed RPC or missing durable proof blocks irreversible deletion',async()=>{
 for(const response of [
  {data:null,error:{code:'PGRST202'}},{data:null,error:null},
  {data:false,error:null},{data:{...ready,uploadBarrierEnforced:false},error:null},
  {data:{...ready,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},error:null},
  {data:{...ready,completePrivateStorage:false},error:null},
  {data:{...ready,durableCheckpointVerified:false},error:null},
  {data:{...ready,extra:true},error:null},
 ]){
  let deleted=0;
  const services={
   claim:async()=>({data:{status:'processing',user_id,request_id}}),
   verifyStorageReadiness:adapter(response).verifyStorageReadiness,
   deleteAuthUser:async()=>{deleted++;return {};},
  };
  assert.equal(await executeDeletionOnce(request,services),'storage_not_accepted');
  assert.equal(deleted,0);
 }
});
test('refuses client-supplied request identity or missing server RPC',async()=>{
 assert.throws(()=>createOperationalStorageReadiness({supabase:{}}),/service-role/);
 const a=adapter({data:ready,error:null});
 await assert.rejects(a.verifyStorageReadiness({user_id:'not-a-uuid',request_id}),/Exact/);
 assert.equal(a.calls.length,0);
});
