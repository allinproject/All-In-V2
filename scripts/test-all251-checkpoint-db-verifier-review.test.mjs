import assert from 'node:assert/strict';
import test from 'node:test';
import {createDeletionCheckpointDatabaseReviewAdapter} from '../supabase/functions/_shared/trainingDeletionCheckpointDbVerifierReview.mjs';

const A='a1111111-a111-4111-8111-a11111111111';
const R='c3333333-c333-4333-8333-c33333333333';
const scope={ownerId:A,requestId:R,bucketId:'v2-private-workout-objects',plannedCount:2};

test('sends exact binding to service-only database checkpoint RPC',async()=>{
 let received;
 const adapter=createDeletionCheckpointDatabaseReviewAdapter({supabase:{
  rpc:async(name,args)=>{received={name,args};return {data:true,error:null};},
 }});
 assert.equal(await adapter.verifyBucketCheckpoints(scope),true);
 assert.deepEqual(received,{name:'v2_review_account_deletion_bucket_checkpoints',
  args:{p_expected_owner_id:A,p_expected_request_id:R,
   p_bucket_id:scope.bucketId,p_expected_count:2}});
});
test('database false and malformed results never authorize cleanup',async()=>{
 for(const result of [{data:false,error:null},{data:null,error:null},
  {data:'true',error:null},{data:true,error:{message:'denied'}}]){
  const adapter=createDeletionCheckpointDatabaseReviewAdapter({supabase:{rpc:async()=>result}});
  if(result.data===false)assert.equal(await adapter.verifyBucketCheckpoints(scope),false);
  else await assert.rejects(adapter.verifyBucketCheckpoints(scope),/unavailable/);
 }
});
test('invalid scope and missing server RPC are rejected',async()=>{
 assert.throws(()=>createDeletionCheckpointDatabaseReviewAdapter({supabase:{}}),/service-only/);
 const adapter=createDeletionCheckpointDatabaseReviewAdapter({supabase:{rpc:async()=>({data:true})}});
 for(const bad of [{...scope,ownerId:'invalid'},{...scope,requestId:'invalid'},
  {...scope,bucketId:'../other'},{...scope,plannedCount:-1},
  {...scope,plannedCount:10001},{...scope,plannedCount:1.5}])
  await assert.rejects(adapter.verifyBucketCheckpoints(bad),/scope required/);
});
