import test from "node:test";
import assert from "node:assert/strict";
import {createCoachOpenAiResponsesTransport} from "./coachOpenAiResponsesTransport.mjs";
const context={kind:"ready",noWriteAuthority:true,
 acceptedPlan:{id:"plan",revision:5},activeRestrictions:[{subject:"lying leg curl"}],
 relevantHistory:[],incompleteHistory:true,warnings:["partial"]};
const answer={status:"completed",output:[{type:"message",role:"assistant",
 content:[{type:"output_text",text:"I cannot verify your full history."}]}],
 usage:{input_tokens:120,output_tokens:40}};
const args={instructions:"Respect verified restrictions.",userContent:"What is my gym plan?",
 context,reservationId:"opaque-reservation",maxOutputTokens:256};
function setup(){
 let calls=0;
 const options={apiKey:"server-only-test-secret",model:"reviewed-model-id",
  inputUsdPerMillion:1,outputUsdPerMillion:4,timeoutMs:2000,
  fetchImpl:async(url,init)=>{calls++;
   assert.equal(url,"https://api.openai.com/v1/responses");
   assert.equal(init.headers.authorization,"Bearer server-only-test-secret");
   const body=JSON.parse(init.body);
   assert.equal(body.store,false);assert.equal(body.stream,false);
   assert.equal(body.max_output_tokens,256);assert.equal(body.model,"reviewed-model-id");
   assert.equal(body.tools,undefined);
   assert.match(body.instructions,/lying leg curl/);
   return {ok:true,json:async()=>structuredClone(answer)};
  }};
 return {options,calls:()=>calls};
}
test("server model transport sends certified bounded context without storage or tools",async()=>{
 const x=setup();
 const response=await createCoachOpenAiResponsesTransport(x.options)(args);
 assert.equal(x.calls(),1);
 assert.equal(response.message,"I cannot verify your full history.");
 assert.equal(response.usage.inputTokens,120);
 assert.equal(response.usage.outputTokens,40);
 assert.equal(response.usage.costUsd,0.00028);
});
test("unconfigured pricing and keys cannot call a model",()=>{
 for(const change of [
  x=>{x.apiKey=""},x=>{x.outputUsdPerMillion=0},x=>{x.model="wrong id with spaces"},
  x=>{x.timeoutMs=0},x=>{x.fetchImpl=null}
 ]){
  const x=setup();change(x.options);
  assert.throws(()=>createCoachOpenAiResponsesTransport(x.options),/not_configured/);
 }
});
test("invalid or unverified owner context never reaches fetch",async()=>{
 const x=setup(),invoke=createCoachOpenAiResponsesTransport(x.options);
 for(const bad of [null,{kind:"ready",noWriteAuthority:false},{kind:"blocked"}]){
  await assert.rejects(()=>invoke({...args,context:bad}),/unconfirmed/);
 }
 assert.equal(x.calls(),0);
});
test("upstream failure, incomplete model output, tool output, missing usage block",async()=>{
 for(const body of [
  {...answer,status:"incomplete"},
  {...answer,usage:null},
  {...answer,output:[{type:"function_call",name:"write_plan"}]},
  {...answer,output:[]},
  {...answer,output:[{type:"message",role:"assistant",content:[{type:"refusal",refusal:"no"}]}]},
  {...answer,usage:{input_tokens:-1,output_tokens:40}},
 ]){
  const x=setup();x.options.fetchImpl=async()=>({ok:true,json:async()=>body});
  await assert.rejects(()=>createCoachOpenAiResponsesTransport(x.options)(args),/unconfirmed/);
 }
 const x=setup();x.options.fetchImpl=async()=>{throw Error("private upstream message")};
 await assert.rejects(()=>createCoachOpenAiResponsesTransport(x.options)(args),/unconfirmed/);
});
test("model HTTP failure never leaks private upstream body",async()=>{
 const x=setup();x.options.fetchImpl=async()=>({ok:false,status:429});
 await assert.rejects(()=>createCoachOpenAiResponsesTransport(x.options)(args),/unconfirmed/);
});

test("structured accepted workout prescriptions are sent unchanged, not summarized",async()=>{
 let prompt="";const x=setup();x.options.fetchImpl=async(_,init)=>{
  prompt=JSON.parse(init.body).instructions;
  return {ok:true,json:async()=>structuredClone(answer)};
 };
 const fullContext={...context,plannedDay:{verified:true,localDate:"2026-11-12",
  calendarDays:[{planId:"plan",revisionId:"rev",dayState:"planned"}],
  sessions:[{sessionId:"session",planId:"plan",revisionId:"rev",
   intent:{supersets:[{major:"split squat",abs:"cable crunch",rounds:3}]}}]}};
 await createCoachOpenAiResponsesTransport(x.options)({...args,context:fullContext});
 assert.match(prompt,/split squat/);
 assert.match(prompt,/cable crunch/);
 assert.match(prompt,/rounds/);
});
test("an input whose worst-case cost exceeds the reserved cap never reaches provider",async()=>{
 const x=setup(),invoke=createCoachOpenAiResponsesTransport(x.options);
 await assert.rejects(()=>invoke({...args,userContent:"x".repeat(12000)}),/unconfirmed/);
 assert.equal(x.calls(),0);
});
