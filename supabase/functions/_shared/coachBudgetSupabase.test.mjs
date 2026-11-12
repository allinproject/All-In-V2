import test from "node:test";
import assert from "node:assert/strict";
import {createCoachBudgetSupabase} from "./coachBudgetSupabase.mjs";
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reservation="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
test("service-only reservation forwards canonical owner and request",async()=>{
 const calls=[];
 const b=createCoachBudgetSupabase({serviceClient:{rpc:async(n,p)=>{
  calls.push([n,p]);return {data:{approved:true,ownerId:owner,clientRequestId:request,
   reservationId:reservation,maximumUsd:0.005}}}}});
 const receipt=await b.reserveBudget({ownerId:owner,clientRequestId:request,
  maximumUsd:0.005,maxOutputTokens:256});
 assert.equal(receipt.reservationId,reservation);
 assert.equal(calls[0][0],"v2_coach_budget_reserve");
 assert.equal(calls[0][1].p_maximum_usd,0.005);
});
test("verified metering settlement requires matching owner and request",async()=>{
 const b=createCoachBudgetSupabase({serviceClient:{rpc:async(n,p)=>{
  assert.equal(n,"v2_coach_budget_settle");
  assert.equal(p.p_reservation_id,reservation);
  return {data:{confirmed:true,ownerId:owner,clientRequestId:request}};
 }}});
 const result=await b.settleBudget({ownerId:owner,clientRequestId:request,
  reservationId:reservation,inputTokens:10,outputTokens:20,costUsd:0.0002});
 assert.equal(result.confirmed,true);
});
test("rejects synthetic owners, cross-owner receipts and storage errors",async()=>{
 for(const row of [{approved:true,ownerId:"other",clientRequestId:request,
   reservationId:reservation,maximumUsd:0.005},{approved:false},
   null]){
  const b=createCoachBudgetSupabase({serviceClient:{rpc:async()=>({data:row})}});
  await assert.rejects(()=>b.reserveBudget({ownerId:owner,clientRequestId:request,
   maximumUsd:0.005,maxOutputTokens:256}),/unavailable/);
 }
 const b=createCoachBudgetSupabase({serviceClient:{rpc:async()=>({error:{message:"no schema"}})}});
 await assert.rejects(()=>b.settleBudget({ownerId:owner,clientRequestId:request,
  reservationId:reservation,inputTokens:1,outputTokens:1,costUsd:0.0001}),/unavailable/);
});
test("never releases uncertain charges or accepts caller-overridden budget",async()=>{
 const b=createCoachBudgetSupabase({serviceClient:{rpc:async()=>{throw Error("must not call")}}});
 await assert.rejects(()=>b.releaseBudget(),/requires_proof/);
 await assert.rejects(()=>b.reserveBudget({ownerId:owner,clientRequestId:request,
  maximumUsd:1,maxOutputTokens:256}),/unavailable/);
});
