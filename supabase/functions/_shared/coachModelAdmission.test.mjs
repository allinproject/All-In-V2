import test from "node:test";
import assert from "node:assert/strict";
import {createCoachModelGenerator} from "./coachModelAdmission.mjs";
const user="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const thread="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reservation="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const date="2026-11-12T20:00:00Z";
const turn={ownerId:user,threadId:thread,clientRequestId:request,userContent:"What is my workout?"};
function context(){
 return {
  ownerId:user,accessGateReady:true,restrictionsVerified:true,
  historyCertification:{verified:true,ownerId:user,sourceRef:"canonical-training-read",
   readAt:"2026-11-12T19:59:50Z"},
  history:{
   version:1,generatedAt:"2026-11-12T19:59:40Z",
   requested:{fromDate:"2026-11-01",throughDate:"2026-11-12",sports:["strength"]},
   completeness:"partial",warnings:["Imported workouts may be missing."],
   currentPlan:{id:"plan",revision:4,status:"accepted"},
   restrictions:[{id:"ban",category:"exercise",subject:"lying leg curl",
    source:"explicit_user",status:"active",updatedAt:"2026-11-11T00:00:00Z"}],
   coverage:[{sport:"strength",fromDate:"2026-11-01",throughDate:"2026-11-12",status:"partial",missingIntervals:[]}],
   events:[]
  }
 };
}
function setup(){
 const calls={read:0,reserve:0,model:0,settle:0,release:0};
 const options={
  now:()=>date,maxCostUsd:0.005,maxOutputTokens:256,
  readContext:async()=>{calls.read++;return context()},
  buildInstructions:async()=> "Use only verified saved plan/restrictions; do not claim saved changes.",
  reserveBudget:async({ownerId,clientRequestId,maximumUsd})=>{
   calls.reserve++;return {approved:true,ownerId,clientRequestId,reservationId:reservation,maximumUsd}
  },
  invokeModel:async args=>{calls.model++;return {message:"Your saved workout details are not available.",
   usage:{inputTokens:150,outputTokens:12,costUsd:0.0003}}},
  settleBudget:async({ownerId,clientRequestId})=>{
   calls.settle++;return {confirmed:true,ownerId,clientRequestId}},
  releaseBudget:async()=>{calls.release++}
 };
 return {calls,options,generate:()=>createCoachModelGenerator(options)};
}
test("verified owner context and durable spend reservation precede model",async()=>{
 const x=setup(),order=[];
 x.options.readContext=async()=>{order.push("read");return context()};
 x.options.reserveBudget=async args=>{order.push("reserve");return {
  approved:true,ownerId:args.ownerId,clientRequestId:args.clientRequestId,
  reservationId:reservation,maximumUsd:args.maximumUsd}};
 x.options.invokeModel=async()=>{order.push("model");return {
  message:"I need your current saved exercise details.",
  usage:{inputTokens:150,outputTokens:12,costUsd:0.0003}}};
 x.options.settleBudget=async args=>{order.push("settle");return {
  confirmed:true,ownerId:args.ownerId,clientRequestId:args.clientRequestId}};
 const result=await x.generate()(turn);
 assert.match(result.message,/saved exercise/);
 assert.deepEqual(order,["read","reserve","model","settle"]);
});
test("unknown or mismatched owner context fails before spending any tokens",async()=>{
 const x=setup();x.options.readContext=async()=>({...context(),ownerId:"wrong"});
 await assert.rejects(()=>x.generate()(turn),/owner_context_unverified/);
 assert.equal(x.calls.reserve,0);assert.equal(x.calls.model,0);
});
test("unverified restrictions, missing access, stale history and fabricated complete coverage fail closed",async()=>{
 for(const change of [
  c=>{c.restrictionsVerified=false},
  c=>{c.accessGateReady=false},
  c=>{c.historyCertification.readAt="2026-11-11T00:00:00Z"},
  c=>{c.history.completeness="complete_for_requested_scope"}
 ]){
  const x=setup(),c=context();change(c);
  x.options.readContext=async()=>c;
  await assert.rejects(()=>x.generate()(turn),/coach_model_/);
  assert.equal(x.calls.model,0);assert.equal(x.calls.reserve,0);
 }
});
test("no model invocation without exactly matching durable budget reservation",async()=>{
 for(const result of [
  {approved:false},
  {approved:true,ownerId:"wrong",clientRequestId:request,
   reservationId:reservation,maximumUsd:0.005},
  {approved:true,ownerId:user,clientRequestId:request,
   reservationId:"invalid",maximumUsd:0.005},
  {approved:true,ownerId:user,clientRequestId:request,
   reservationId:reservation,maximumUsd:0.5}
 ]){
  const x=setup();x.options.reserveBudget=async()=>result;
  await assert.rejects(()=>x.generate()(turn),/budget_denied/);
  assert.equal(x.calls.model,0);
 }
});
test("metered but rejected model responses still settle their real spend",async()=>{
 for(const [output,expectedSettlements] of [
  [{message:"Safe",usage:{inputTokens:10,outputTokens:10,costUsd:0.01}},0],
  [{message:"Safe",usage:{inputTokens:10,outputTokens:10}},0],
  [{message:"Safe",usage:{inputTokens:10,outputTokens:10,costUsd:0.001},
    proposed_action:{type:"update_training_plan"}},1],
  [{message:"",usage:{inputTokens:10,outputTokens:10,costUsd:0.001}},1]
 ]){
  const x=setup();x.options.invokeModel=async()=>output;
  await assert.rejects(()=>x.generate()(turn),/output_or_metering_invalid/);
  assert.equal(x.calls.settle,expectedSettlements);
 }
});
test("output-token overruns are charged but never returned to the client",async()=>{
 const x=setup();x.options.invokeModel=async()=>({
  message:"This must not be displayed.",
  usage:{inputTokens:100,outputTokens:257,costUsd:0.0005}});
 await assert.rejects(()=>x.generate()(turn),/output_token_limit_exceeded/);
 assert.equal(x.calls.settle,1);
});
test("hard-restricted movement in a generated answer is blocked pre-display",async()=>{
 const x=setup();x.options.invokeModel=async()=>({
  message:"Do lying leg curls today.",usage:{inputTokens:10,outputTokens:10,costUsd:0.0001}});
 await assert.rejects(()=>x.generate()(turn),/hard_restriction_violated/);
 assert.equal(x.calls.settle,1);
});
test("model transport failure releases reservation and suppresses answer",async()=>{
 const x=setup();x.options.invokeModel=async()=>{throw Error("secret upstream failure")};
 await assert.rejects(()=>x.generate()(turn),/transport_failed/);
 assert.equal(x.calls.release,1);assert.equal(x.calls.settle,0);
});
test("failed spend settlement fails closed rather than claiming a persisted reply",async()=>{
 const x=setup();x.options.settleBudget=async()=>({confirmed:false});
 await assert.rejects(()=>x.generate()(turn),/spend_unconfirmed/);
});
test("invalid configuration cannot bypass budget or provider checks",()=>{
 for(const change of [
  x=>{x.reserveBudget=undefined},
  x=>{x.maxCostUsd=0},
  x=>{x.maxCostUsd=1},
  x=>{x.maxOutputTokens=10000},
  x=>{x.readContext=undefined}
 ]){
  const x=setup();change(x.options);
  assert.throws(()=>x.generate(),/not_configured/);
 }
});
