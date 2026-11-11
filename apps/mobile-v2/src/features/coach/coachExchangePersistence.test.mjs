import test from "node:test";
import assert from "node:assert/strict";
import {persistVerifiedCoachExchange} from "./coachExchangePersistence.mjs";
const request=()=>({ownerId:"a",sessionGeneration:3,threadId:"thread-1",clientRequestId:"r1",userMessageId:"u1",assistantMessageId:"m1",userContent:"How should I run?",assistantContent:"Let's review your accepted plan."});
const adapter=(req=request())=>({
 isCurrent:()=>true,
 ensureOwner:async()=>req.ownerId,
 appendExchange:async()=>({ok:true,threadId:req.threadId,userMessageId:req.userMessageId,assistantMessageId:req.assistantMessageId}),
 readExchange:async()=>[
  {ownerId:req.ownerId,threadId:req.threadId,id:req.userMessageId,role:"user",content:req.userContent},
  {ownerId:req.ownerId,threadId:req.threadId,id:req.assistantMessageId,role:"assistant",content:req.assistantContent}
 ]
});
test("canonical write and exact readback produce a receipt",async()=>{
 const x=await persistVerifiedCoachExchange(request(),adapter());
 assert.equal(x.status,"saved_verified");assert.equal(x.receipt.assistantMessageId,"m1");
});
test("RPC success without matching persisted assistant content is not saved",async()=>{
 const a=adapter();a.readExchange=async()=>[
  {ownerId:"a",threadId:"thread-1",id:"u1",role:"user",content:"How should I run?"},
  {ownerId:"a",threadId:"thread-1",id:"m1",role:"assistant",content:"Wrong reply"}
 ];
 const x=await persistVerifiedCoachExchange(request(),a);
 assert.equal(x.status,"not_saved");assert.equal(x.reason,"readback_mismatch");
});
test("same IDs but different account rows cannot confirm a save",async()=>{
 const a=adapter();const read=a.readExchange;
 a.readExchange=async()=>(await read()).map(row=>({...row,ownerId:"b"}));
 assert.equal((await persistVerifiedCoachExchange(request(),a)).reason,"readback_mismatch");
});
test("owner cannot change during save",async()=>{
 const a=adapter();a.ensureOwner=async()=> "b";
 assert.equal((await persistVerifiedCoachExchange(request(),a)).reason,"wrong_owner");
});
test("in-flight session change suppresses a late successful save claim",async()=>{
 let current=true;
 const a=adapter();
 a.isCurrent=()=>current;
 a.appendExchange=async()=>{current=false;return {ok:true,threadId:"thread-1",userMessageId:"u1",assistantMessageId:"m1"}};
 assert.equal((await persistVerifiedCoachExchange(request(),a)).reason,"stale_session");
});
test("missing or malformed write receipt never implies persistence",async()=>{
 const a=adapter();a.appendExchange=async()=>({ok:true,threadId:"thread-1",userMessageId:"u1",assistantMessageId:"wrong"});
 assert.equal((await persistVerifiedCoachExchange(request(),a)).reason,"write_unconfirmed");
});
test("network uncertainty preserves retry requirement, no fabricated save",async()=>{
 const a=adapter();a.appendExchange=async()=>{throw Error("network lost")};
 const x=await persistVerifiedCoachExchange(request(),a);
 assert.equal(x.status,"not_saved");assert.equal(x.retryable,true);
});
test("same IDs and content can be retried without deriving new identities",async()=>{
 const r=request();const a=adapter(r);
 const first=await persistVerifiedCoachExchange(r,a);
 const second=await persistVerifiedCoachExchange(r,a);
 assert.equal(first.status,"saved_verified");assert.deepEqual(second.receipt,first.receipt);
});
test("invalid content and duplicate message IDs fail before any write",async()=>{
 let calls=0;const a=adapter();a.appendExchange=async()=>{calls++;throw Error("should not write")};
 assert.equal((await persistVerifiedCoachExchange({...request(),assistantContent:""},a)).reason,"invalid_exchange");
 assert.equal((await persistVerifiedCoachExchange({...request(),assistantMessageId:"u1"},a)).reason,"invalid_exchange");
 assert.equal(calls,0);
});
test("readback failure leaves save unverified",async()=>{
 const a=adapter();a.readExchange=async()=>{throw Error("reader unavailable")};
 assert.equal((await persistVerifiedCoachExchange(request(),a)).status,"not_saved");
});

test("trimmed canonical content verifies without changing caller input",async()=>{
 const req={...request(),userContent:"  How should I run?  ",assistantContent:"  Let's review your accepted plan.  "};
 const expected={...req,userContent:"How should I run?",assistantContent:"Let's review your accepted plan."};
 const a=adapter(expected);
 let sent=null;
 const append=a.appendExchange;
 a.appendExchange=async(value)=>{sent=value;return append(value);};
 const result=await persistVerifiedCoachExchange(req,a);
 assert.equal(result.status,"saved_verified");
 assert.equal(sent.userContent,expected.userContent);
 assert.equal(sent.assistantContent,expected.assistantContent);
 assert.equal(req.userContent,"  How should I run?  ");
 assert.equal(req.assistantContent,"  Let's review your accepted plan.  ");
});
