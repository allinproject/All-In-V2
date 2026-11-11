import test from "node:test";
import assert from "node:assert/strict";
import {persistVerifiedCoachExchange} from "./coachExchangePersistence.mjs";
import {decodeCoachAppendReceipt,decodeCoachExchangeRows} from "./coachOwnerWire.mjs";

const request=()=>({
 ownerId:"owner-a",sessionGeneration:7,threadId:"thread-1",
 clientRequestId:"req-1",userMessageId:"user-1",assistantMessageId:"assistant-1",
 userContent:"Help me review my run",assistantContent:"Your canonical data is incomplete."
});
function adapterFor(requestData,mutation=(x)=>x){
 const rawReceipt={
  ok:true,thread_id:requestData.threadId,client_request_id:requestData.clientRequestId,
  user_message_id:requestData.userMessageId,assistant_message_id:requestData.assistantMessageId
 };
 const rawRows=[
  {message_id:requestData.userMessageId,user_id:requestData.ownerId,
   thread_id:requestData.threadId,client_request_id:requestData.clientRequestId,
   role:"user",content:requestData.userContent},
  {message_id:requestData.assistantMessageId,user_id:requestData.ownerId,
   thread_id:requestData.threadId,client_request_id:requestData.clientRequestId,
   role:"assistant",content:requestData.assistantContent}
 ];
 return {
  ensureOwner:async()=>requestData.ownerId,
  isCurrent:()=>true,
  appendExchange:async(payload)=>decodeCoachAppendReceipt(rawReceipt,payload),
  readExchange:async()=>decodeCoachExchangeRows(mutation(rawRows),requestData)
 };
}
test("proposed SQL receipt and owner-tagged rows compose into verified save",async()=>{
 const r=request();
 const outcome=await persistVerifiedCoachExchange(r,adapterFor(r));
 assert.equal(outcome.status,"saved_verified");
 assert.equal(outcome.receipt.assistantMessageId,r.assistantMessageId);
});
test("missing owner or request columns block save despite successful append",async()=>{
 const r=request();
 for(const missing of ["user_id","client_request_id"]){
  const a=adapterFor(r,rows=>rows.map(row=>{
   const copy={...row};delete copy[missing];return copy;
  }));
  assert.equal((await persistVerifiedCoachExchange(r,a)).status,"not_saved");
 }
});
test("cross-account reply does not survive the wire mapping",async()=>{
 const r=request();
 const a=adapterFor(r,rows=>rows.map((row,i)=>i===1?{...row,user_id:"owner-b"}:row));
 assert.equal((await persistVerifiedCoachExchange(r,a)).status,"not_saved");
});
test("response ID or message ID mismatches never become save evidence",async()=>{
 const r=request();
 const a=adapterFor(r,rows=>rows.map((row,i)=>i===1?{...row,message_id:"wrong"}:row));
 assert.equal((await persistVerifiedCoachExchange(r,a)).status,"not_saved");
});
