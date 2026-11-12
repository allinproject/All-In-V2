import test from "node:test";
import assert from "node:assert/strict";
import {createCoachArmedRuntime} from "./coachArmedRuntime.mjs";

/** Whole staged chain, entirely synthetic: no real database or paid API. */
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const thread="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const requestId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const userMessageId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const assistantMessageId="ffffffff-ffff-4fff-8fff-ffffffffffff";
const reservationId="11111111-1111-4111-8111-111111111111";
const planId="22222222-2222-4222-8222-222222222222";
const revisionId="33333333-3333-4333-8333-333333333333";
const plannedId="44444444-4444-4444-8444-444444444444";
const completedId="55555555-5555-4555-8555-555555555555";
const restrictedId="66666666-6666-4666-8666-666666666666";
const answer="Your recent run is recorded. Today's accepted strength routine is planned, not completed.";
const today=new Date().toISOString().slice(0,10);
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const occurredAt=yesterday+"T10:00:00Z";
const recordedAt=yesterday+"T12:00:00Z";
const send={bearerToken:"signed-synthetic-test-jwt",ownerId:owner,
 threadId:thread,clientRequestId:requestId,userMessageId,
 assistantMessageId,userContent:"What training have I actually completed?"};

function fixture({certified=true,modelOk=true}={}){
 const calls=[];
 let activeOwner=owner,claimStatus="claimed",stored=null;
 const userClient={
  auth:{getUser:async token=>({data:{user:{id:activeOwner}},error:token===send.bearerToken?null:{message:"wrong token"}})},
  rpc:async(name,args)=>{
   calls.push(name);
   switch(name){
    case "v2_my_profile_state":return {data:{
     profile:{user_id:owner},
     settings:{settings:{training_preferences:{timezone:"UTC"}}},
     required_legal_documents:["terms","privacy","founder_beta_terms"].map(k=>({
      document_key:k,version:"v1",title:k,content_markdown:"Reviewed synthetic document"})),
     latest_legal_acceptance:{age_18_confirmed:true,terms_version:"v1",
      privacy_version:"v1",founder_beta_terms_version:"v1"},
     onboarding:{completed_steps:["focus","training_pattern","availability","coach",
      "food_safety","proactivity"],skipped_steps:[]}
    },error:null};
    case "v2_training_day_read_candidate":return {data:{ownerId:owner,
     localDate:args.p_athlete_date,calendarDays:[{planId,revisionId,
      localDate:args.p_athlete_date,dayState:"planned"}],
     plannedWorkouts:[{sessionId:plannedId,planId,revisionId,
      localDate:args.p_athlete_date,sport:"strength",sessionKind:"superset",
      purpose:"Three rounds of paired sets",intentSchemaVersion:"session-intent-v1",
      intent:{blocks:[{rounds:3,major:"split squat",abs:"cable crunch"}]}}]
    },error:null};
    case "v2_training_active_restrictions_read_candidate":return {data:{
     ownerId:owner,verified:certified,certifiedRevision:1,
     restrictions:[{id:restrictedId,category:"exercise",subject:"lying leg curl",
      status:"active",source:"explicit_user",updatedAt:occurredAt}]
    },error:null};
    case "v2_completed_activity_coach_recent_candidate":return {data:{
     ownerId:owner,fromDate:args.p_from_date,throughDate:args.p_through_date,
     coverage:"partial_canonical_completed_identity",verified:true,
     moreAvailable:false,activities:[{activityId:completedId,ownerId:owner,
      sport:"running",localDate:yesterday,status:"completed",kind:"workout",
      captureKind:"device_measured",version:1,startedAt:occurredAt,recordedAt}]
    },error:null};
    case "v2_coach_read_exchange":return {data:stored?[
     {message_id:userMessageId,user_id:owner,thread_id:thread,
      client_request_id:requestId,role:"user",content:send.userContent},
     {message_id:assistantMessageId,user_id:owner,thread_id:thread,
      client_request_id:requestId,role:"assistant",content:stored}
    ]:[],error:null};
    case "v2_coach_create_thread":return {data:thread,error:null};
    case "v2_coach_read_messages":return {data:[],error:null};
    default:throw Error("Unexpected user RPC "+name);
   }
  }
 };
 const serverClient={rpc:async(name,args)=>{
  calls.push(name);
  switch(name){
   case "v2_coach_claim_turn":return {data:{
    action:claimStatus,execution_version:1},error:null};
   case "v2_coach_budget_reserve":return {data:{
    approved:true,ownerId:owner,clientRequestId:requestId,
    reservationId,maximumUsd:0.005},error:null};
   case "v2_coach_budget_settle":return {data:{
    confirmed:true,ownerId:owner,clientRequestId:requestId},error:null};
   case "v2_coach_append_exchange":
    stored=args.p_assistant_content;
    return {data:{ok:true,thread_id:thread,client_request_id:requestId,
     user_message_id:userMessageId,assistant_message_id:assistantMessageId},error:null};
   case "v2_coach_finish_turn":return {data:{completed:true},error:null};
   default:throw Error("Unexpected service RPC "+name);
  }
 }};
 let networkCalls=0,prompt=null;
 const fetchImpl=async(url,options)=>{
  calls.push("provider_fetch");networkCalls++;
  assert.equal(url,"https://api.openai.com/v1/responses");
  assert.equal(options.headers.authorization,"Bearer synthetic-server-key");
  prompt=JSON.parse(options.body);
  if(!modelOk)throw Error("synthetic upstream timeout");
  return {ok:true,json:async()=>({status:"completed",
   output:[{type:"message",role:"assistant",
    content:[{type:"output_text",text:answer}]}],
   usage:{input_tokens:180,output_tokens:35}})};
 };
 const runtime=createCoachArmedRuntime({
  userClient,serverClient,bearerToken:send.bearerToken,
  apiKey:"synthetic-server-key",model:"test-model-id",
  inputUsdPerMillion:1,outputUsdPerMillion:4,fetchImpl
 });
 return {runtime,calls,prompt:()=>prompt,networkCalls:()=>networkCalls,
  switchOwner:()=>{activeOwner=other},
  completed:()=>{claimStatus="completed"},stored:()=>stored};
}

test("entire armed Coach runtime reads canonical owners, reserves first, settles and verifies saved pair",async()=>{
 const f=fixture();
 const result=await f.runtime.executeExchange(send);
 assert.equal(result.status,"saved_verified");
 assert.equal(result.message,answer);
 assert.equal(result.receipt.assistantMessageId,assistantMessageId);
 assert.equal(f.networkCalls(),1);
 assert.equal(f.stored(),answer);
 const calls=f.calls;
 const order=["v2_coach_claim_turn","v2_training_day_read_candidate",
  "v2_training_active_restrictions_read_candidate",
  "v2_completed_activity_coach_recent_candidate","v2_coach_budget_reserve",
  "provider_fetch","v2_coach_budget_settle",
  "v2_coach_append_exchange","v2_coach_read_exchange",
  "v2_coach_finish_turn"].map(n=>calls.indexOf(n));
 assert(order.every(n=>n>=0),"Every required owner, ledger and persistence boundary must run");
 assert(order.slice(3).every((n,i)=>i===0||n>order[i+2]),
  "Budget reservation must precede fetch, settlement and canonical save");
 const provider=f.prompt();
 assert.equal(provider.store,false);assert.equal(provider.tools,undefined);
 assert.match(provider.instructions,/split squat/);
 assert.match(provider.instructions,/cable crunch/);
 assert.match(provider.instructions,/lying leg curl/);
 assert.match(provider.instructions,/partial/);
 assert.match(provider.instructions,/completed_session/);
 assert.doesNotMatch(provider.instructions,/"kind":"planned_session"/);
});
test("replay of exact completed request reads saved answer without a second model or budget hold",async()=>{
 const f=fixture();
 assert.equal((await f.runtime.executeExchange(send)).status,"saved_verified");
 f.completed();
 const reply=await f.runtime.executeExchange(send);
 assert.equal(reply.status,"saved_verified");
 assert.equal(reply.replayed,true);
 assert.equal(f.networkCalls(),1);
 assert.equal(f.calls.filter(n=>n==="v2_coach_budget_reserve").length,1);
});
test("uncertified restrictions prevent both ledger reservation and provider calls",async()=>{
 const f=fixture({certified:false});
 const r=await f.runtime.executeExchange(send);
 assert.equal(r.status,"blocked");
 assert.equal(f.networkCalls(),0);
 assert(!f.calls.includes("v2_coach_budget_reserve"));
 assert(!f.calls.includes("v2_coach_append_exchange"));
});
test("account switch is rejected before any provider use",async()=>{
 const f=fixture();f.switchOwner();
 const r=await f.runtime.executeExchange(send);
 assert.equal(r.reason,"authentication_mismatch");
 assert.equal(f.networkCalls(),0);
 assert(!f.calls.includes("v2_coach_budget_reserve"));
});
test("ambiguous upstream failure keeps reservation and never claims a saved response",async()=>{
 const f=fixture({modelOk:false});
 const r=await f.runtime.executeExchange(send);
 assert.equal(r.status,"blocked");
 assert.equal(f.networkCalls(),1);
 assert.equal(f.calls.filter(n=>n==="v2_coach_budget_reserve").length,1);
 assert(!f.calls.includes("v2_coach_budget_settle"));
 assert(!f.calls.includes("v2_coach_append_exchange"));
 assert(!f.calls.some(n=>n.includes("release")));
});
