import test from "node:test";
import assert from "node:assert/strict";
import {handleCoachRuntimeRequest} from "./coachRuntimeIngress.mjs";

const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const thread="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const assistantId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const req=(data,method="POST",headers={})=>new Request("http://localhost/functions/v1/v2-coach",{
 method,headers:{"authorization":"Bearer signed-jwt","content-type":"application/json",...headers},
 body:method==="POST"?(typeof data==="string"?data:JSON.stringify(data)):undefined});
const deps=()=>({
 verifyUser:async t=>t==="signed-jwt"?{id:owner}:null,
 createOrResumeThread:async()=>({ownerId:owner,threadId:thread}),
 readTranscriptPage:async()=>({messages:[{id:userId,threadId:thread,role:"user",content:"Hello"}],
   hasMore:false,nextCursor:null}),
 executeExchange:async()=>({status:"saved_verified",message:"Safe answer",
   receipt:{ownerId:owner,threadId:thread,clientRequestId:requestId,userMessageId:userId,assistantMessageId:assistantId}})
});
const send={action:"send",ownerId:owner,threadId:thread,clientRequestId:requestId,
 userMessageId:userId,assistantMessageId:assistantId,message:" Help me train "};
const call=async(body,d=deps(),options={enabled:true})=>{
 const result=await handleCoachRuntimeRequest(req(body),d,options);
 return {status:result.status,body:await result.json()};
};

test("default OFF refuses before validating a bearer or invoking any owner dependency",async()=>{
 let touched=0;const d={verifyUser:async()=>{touched++;return {id:owner}}};
 const result=await call(send,d,{});
 assert.deepEqual(result,{status:503,body:{code:"coach_disabled"}});
 assert.equal(touched,0);
});
test("canonical first-open returns existing owner thread, not caller's candidate",async()=>{
 const result=await call({action:"open",ownerId:owner,
  candidateThreadId:"ffffffff-ffff-4fff-8fff-ffffffffffff"});
 assert.equal(result.status,200);assert.equal(result.body.threadId,thread);
});
test("bounded history returns only owner-checked transcript",async()=>{
 const result=await call({action:"history",ownerId:owner,threadId:thread,limit:10});
 assert.equal(result.status,200);assert.equal(result.body.messages.length,1);
 assert.equal(result.body.messages[0].content,"Hello");
});
test("send needs canonical readback receipt; it never forwards client assistant content",async()=>{
 let captured;const d=deps();
 d.executeExchange=async r=>{captured=r;return deps().executeExchange()};
 const result=await call(send,d);
 assert.equal(result.status,200);
 assert.equal(captured.userContent,"Help me train");
 assert.equal(Object.hasOwn(captured,"assistantContent"),false);
 assert.equal((await call({...send,assistantContent:"forged"})).status,400);
});
test("invalid owner, stale token, or changed owner fails without returning private conversation",async()=>{
 assert.equal((await call({...send,ownerId:"ffffffff-ffff-4fff-8fff-ffffffffffff"})).status,401);
 const d=deps();let n=0;
 d.verifyUser=async()=>++n===1?{id:owner}:{id:"ffffffff-ffff-4fff-8fff-ffffffffffff"};
 assert.equal((await call(send,d)).status,401);
 const stolen=deps();stolen.readTranscriptPage=async()=>({messages:[
  {id:userId,threadId:"ffffffff-ffff-4fff-8fff-ffffffffffff",role:"user",content:"secret"}
 ],hasMore:false,nextCursor:null});
 assert.equal((await call({action:"history",ownerId:owner,threadId:thread},stolen)).status,503);
});
test("rejected claims, provider failures, and fabricated saved replies do not claim success",async()=>{
 const d=deps();d.executeExchange=async()=>({status:"blocked",reason:"claim_not_granted"});
 assert.equal((await call(send,d)).status,503);
 d.executeExchange=async()=>({status:"saved_verified",message:"fake",receipt:{ownerId:owner}});
 assert.equal((await call(send,d)).status,503);
 d.executeExchange=async()=>{throw Error("provider secret")};
 const result=await call(send,d);
 assert.deepEqual(result,{status:503,body:{code:"coach_unavailable"}});
});
test("malformed/oversized messages, unknown actions, forged fields and bad cursors are rejected",async()=>{
 for(const body of [
  {...send,message:""}, {...send,message:"x".repeat(15000)},
  {...send,provider:"OpenAI"}, {...send,userMessageId:assistantId},
  {action:"drop",ownerId:owner},{action:"history",ownerId:owner,threadId:thread,cursor:{beforeCreatedAt:"2026-11-11"}},
  {action:"open",ownerId:owner,candidateThreadId:"invalid"}
 ])assert.equal((await call(body)).status,400);
 assert.equal((await call("not json")).status,400);
});
test("disabled method, content-type, invalid bearer and non-POST fail closed",async()=>{
 const d=deps();
 const get=await handleCoachRuntimeRequest(req(null,"GET"),d,{enabled:true});
 assert.equal(get.status,405);
 const media=await handleCoachRuntimeRequest(req(send,"POST",{"content-type":"text/plain"}),d,{enabled:true});
 assert.equal(media.status,415);
 const auth=await handleCoachRuntimeRequest(req(send,"POST",{"authorization":"Bearer invalid token"}),d,{enabled:true});
 assert.equal(auth.status,401);
});
