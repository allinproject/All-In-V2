import test from "node:test";
import assert from "node:assert/strict";
import {hashCoachRequestTuple,createCoachSupabaseDependencies} from "./coachSupabasePersistence.mjs";
const request=()=>({ownerId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",threadId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
 clientRequestId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",userMessageId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
 assistantMessageId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",userContent:"Help me train"});
const clients=()=>{
 const calls=[];
 const userClient={auth:{getUser:async token=>({data:{user:{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}},error:null})},
 rpc:async(name,args)=>{calls.push({from:"user",name,args});return {data:[],error:null}}};
 const serverClient={rpc:async(name,args)=>{calls.push({from:"server",name,args});
  if(name==="v2_coach_claim_turn")return {data:{action:"claimed",execution_version:2},error:null};
  if(name==="v2_coach_finish_turn")return {data:{completed:true},error:null};
  return {data:{ok:true},error:null};
 }};
 const deps=createCoachSupabaseDependencies({userClient,serverClient,bearerToken:"signed-jwt",
  providerGenerate:async()=>({message:"Provider output"})});
 return {deps,calls,userClient,serverClient};
};
test("server SHA256 fingerprint binds exact owner/thread/IDs/content",async()=>{
 const r=request();const first=await hashCoachRequestTuple(r);
 assert.match(first,/^[a-f0-9]{64}$/);
 assert.equal(await hashCoachRequestTuple({...r,userContent:" Help me train "}),first);
 assert.notEqual(await hashCoachRequestTuple({...r,userContent:"Help me recover"}),first);
 assert.notEqual(await hashCoachRequestTuple({...r,ownerId:"other"}),first);
});
test("JWT verification is server-derived and rejects changed bearer",async()=>{
 const {deps}=clients();
 assert.equal((await deps.verifyUser("signed-jwt")).id,request().ownerId);
 await assert.rejects(()=>deps.verifyUser("other"),/token_context_mismatch/);
});
test("claim and append bind owner IDs, fingerprint and execution fence to service RPC",async()=>{
 const {deps,calls}=clients(),r=request();
 const claim=await deps.claimTurn({...r,requestFingerprint:"a".repeat(64)});
 assert.equal(claim.action,"claimed");assert.equal(claim.executionVersion,2);
 await deps.appendPair({...r,assistantContent:"Reply",executionVersion:2});
 assert.deepEqual(calls.map(x=>x.from),["server","server"]);
 assert.equal(calls[0].args.p_user_id,r.ownerId);
 assert.equal(calls[0].args.p_request_fingerprint,"a".repeat(64));
 assert.equal(calls[1].args.p_execution_version,2);
 assert.equal(calls[1].args.p_assistant_content,"Reply");
});
test("exact readback uses owner JWT RLS client, not privileged service client",async()=>{
 const {deps,calls}=clients(),r=request();
 const rows=await deps.readPair(r);
 assert.deepEqual(rows,[]);
 assert.equal(calls[0].from,"user");
 assert.equal(calls[0].name,"v2_coach_read_exchange");
 assert.equal(calls[0].args.p_expected_user_id,r.ownerId);
});
test("completion preserves exact version and bound service identity",async()=>{
 const {deps,calls}=clients(),r=request();
 assert.deepEqual(await deps.finishClaim({...r,executionVersion:2}),{completed:true});
 assert.equal(calls[0].name,"v2_coach_finish_turn");
 assert.equal(calls[0].args.p_execution_version,2);
});
test("failed owner RPC or invalid readback never becomes proof of saving",async()=>{
 const {userClient,serverClient}=clients(),r=request();
 userClient.rpc=async()=>({data:{not:"rows"},error:null});
 serverClient.rpc=async()=>({data:null,error:{message:"offline"}});
 const d=createCoachSupabaseDependencies({userClient,serverClient,bearerToken:"signed-jwt",
  providerGenerate:async()=>({message:"x"})});
 await assert.rejects(()=>d.readPair(r),/coach_readback_invalid/);
 await assert.rejects(()=>d.claimTurn({...r,requestFingerprint:"a".repeat(64)}),/canonical_coach_owner_unavailable/);
});
test("an incomplete client or absent provider cannot construct trusted host",()=>{
 const {userClient,serverClient}=clients();
 assert.throws(()=>createCoachSupabaseDependencies({userClient,serverClient,bearerToken:"jwt"}),/not_configured/);
 assert.throws(()=>createCoachSupabaseDependencies({userClient,serverClient,
  providerGenerate:async()=>{}}),/not_configured/);
});
