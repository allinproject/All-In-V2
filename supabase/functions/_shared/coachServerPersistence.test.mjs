import test from "node:test";
import assert from "node:assert/strict";
import {executeCoachServerExchange} from "./coachServerPersistence.mjs";
const req=()=>({bearerToken:"jwt",ownerId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
 threadId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
 clientRequestId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
 userMessageId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
 assistantMessageId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
 userContent:"  Help me train  "});
const deps=(r=req())=>({
 verifyUser:async()=>({id:r.ownerId}),
 fingerprintTurn:async()=> "a".repeat(64),
 claimTurn:async()=>({action:"claimed",executionVersion:1}),
 providerGenerate:async()=>({message:"Your plan evidence is incomplete."}),
 appendPair:async v=>({ok:true,thread_id:v.threadId,client_request_id:v.clientRequestId,
   user_message_id:v.userMessageId,assistant_message_id:v.assistantMessageId}),
 readPair:async()=>[
  {message_id:r.userMessageId,user_id:r.ownerId,thread_id:r.threadId,
   client_request_id:r.clientRequestId,role:"user",content:r.userContent.trim()},
  {message_id:r.assistantMessageId,user_id:r.ownerId,thread_id:r.threadId,
   client_request_id:r.clientRequestId,role:"assistant",content:"Your plan evidence is incomplete."}
 ],
 finishClaim:async()=>({completed:true})
});
test("trusted claim, provider, owner readback and fenced completion",async()=>{
 const r=req();const x=await executeCoachServerExchange(r,deps(r));
 assert.equal(x.status,"saved_verified");
 assert.equal(x.receipt.assistantMessageId,r.assistantMessageId);
});
test("caller assistant content is forbidden before provider spend",async()=>{
 const r=req(),d=deps(r);let spent=0;
 d.providerGenerate=async()=>{spent++;return {message:"hi"}};
 assert.equal((await executeCoachServerExchange({...r,assistantContent:"forged"},d)).reason,
 "invalid_or_untrusted_request");
 assert.equal(spent,0);
});
test("unclaimed or unfenced turn never spends provider budget",async()=>{
 for(const claim of [{action:"wait"},{action:"claimed"}]){
  const r=req(),d=deps(r);let spent=0;
  d.claimTurn=async()=>claim;d.providerGenerate=async()=>{spent++;return {message:"hi"}};
  assert.equal((await executeCoachServerExchange(r,d)).status,"blocked");assert.equal(spent,0);
 }
});
test("wrong signed-in owner never spends provider budget",async()=>{
 const r=req(),d=deps(r);let spent=0;
 d.verifyUser=async()=>({id:"wrong"});
 d.providerGenerate=async()=>{spent++;return {message:"hi"}};
 assert.equal((await executeCoachServerExchange(r,d)).reason,"authentication_mismatch");
 assert.equal(spent,0);
});
test("token changed after model output prevents canonical write",async()=>{
 const r=req(),d=deps(r);let n=0,writes=0;
 d.verifyUser=async()=>++n<=2?{id:r.ownerId}:null;
 d.appendPair=async()=>{writes++;return {}};
 assert.equal((await executeCoachServerExchange(r,d)).reason,"authentication_changed");
 assert.equal(writes,0);
});
test("wrong owner in saved row never finishes claim",async()=>{
 const r=req(),d=deps(r);let finishes=0;
 const read=d.readPair;
 d.readPair=async()=>{const rows=await read();return [rows[0],{...rows[1],user_id:"wrong"}]};
 d.finishClaim=async()=>{finishes++;return {completed:true}};
 assert.equal((await executeCoachServerExchange(r,d)).reason,"save_unverified");
 assert.equal(finishes,0);
});
test("unconfirmed completion cannot report a saved reply",async()=>{
 const r=req(),d=deps(r);d.finishClaim=async()=>({completed:false});
 assert.equal((await executeCoachServerExchange(r,d)).reason,"completion_unverified");
});
test("fencing version is passed into append and finish",async()=>{
 const r=req(),d=deps(r);let appended,finished;
 const write=d.appendPair,finish=d.finishClaim;
 d.appendPair=async arg=>{appended=arg;return write(arg)};
 d.finishClaim=async arg=>{finished=arg;return finish(arg)};
 assert.equal((await executeCoachServerExchange(r,d)).status,"saved_verified");
 assert.equal(appended.executionVersion,1);
 assert.equal(finished.executionVersion,1);
});

test("request fingerprint is host-derived and binds exact normalized prompt",async()=>{
 const r=req(),d=deps(r);let input,claimed,spent=0;
 d.fingerprintTurn=async payload=>{input=payload;return "b".repeat(64)};
 d.claimTurn=async payload=>{claimed=payload;return {action:"wait"}};
 d.providerGenerate=async()=>{spent++;return {message:"should not call"}};
 const x=await executeCoachServerExchange({...r,requestFingerprint:"f".repeat(64)},d);
 assert.equal(x.reason,"claim_not_granted");
 assert.equal(input.userContent,"Help me train");
 assert.equal(claimed.requestFingerprint,"b".repeat(64));
 assert.equal(spent,0);
});
test("invalid trusted fingerprint fails before any claim or provider spend",async()=>{
 const r=req(),d=deps(r);let claims=0,spend=0;
 d.fingerprintTurn=async()=>"";
 d.claimTurn=async()=>{claims++;return {action:"claimed",executionVersion:1}};
 d.providerGenerate=async()=>{spend++;return {message:"no"}};
 assert.equal((await executeCoachServerExchange(r,d)).reason,"fingerprint_unavailable");
 assert.equal(claims,0);assert.equal(spend,0);
});

test("completed Coach request replays canonical assistant answer without new provider spend",async()=>{
 const r=req(),d=deps(r);let generated=0,finish=0;
 d.claimTurn=async()=>({action:"completed",executionVersion:1});
 d.providerGenerate=async()=>{generated++;throw Error("must not generate")};
 d.finishClaim=async()=>{finish++;return {completed:true}};
 const output=await executeCoachServerExchange(r,d);
 assert.equal(output.status,"saved_verified");
 assert.equal(output.replayed,true);
 assert.equal(output.message,"Your plan evidence is incomplete.");
 assert.equal(generated,0);assert.equal(finish,0);
});
test("saved-pending-finalize recovers exact saved reply without provider call",async()=>{
 const r=req(),d=deps(r);let generated=0,finished=0;
 d.claimTurn=async()=>({action:"saved_pending_finalize",executionVersion:3});
 d.providerGenerate=async()=>{generated++;throw Error("no duplicate spend")};
 d.finishClaim=async p=>{finished=p.executionVersion;return {completed:true}};
 const output=await executeCoachServerExchange(r,d);
 assert.equal(output.replayed,true);assert.equal(output.status,"saved_verified");
 assert.equal(generated,0);assert.equal(finished,3);
});
test("replay with missing canonical row cannot falsely claim saved",async()=>{
 const r=req(),d=deps(r);let generated=0;
 d.claimTurn=async()=>({action:"completed",executionVersion:1});
 d.readPair=async()=>[];
 d.providerGenerate=async()=>{generated++;return {message:"wrong"}};
 assert.equal((await executeCoachServerExchange(r,d)).reason,"replay_unverified");
 assert.equal(generated,0);
});
test("replay refuses different persisted user prompt even when IDs match",async()=>{
 const r=req(),d=deps(r);let generated=0;
 d.claimTurn=async()=>({action:"completed",executionVersion:1});
 const orig=d.readPair;d.readPair=async()=>{const x=await orig();x[0].content="Different request";return x};
 d.providerGenerate=async()=>{generated++;return {message:"wrong"}};
 assert.equal((await executeCoachServerExchange(r,d)).reason,"replay_unverified");
 assert.equal(generated,0);
});
