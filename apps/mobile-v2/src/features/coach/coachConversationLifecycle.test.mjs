import test from "node:test";
import assert from "node:assert/strict";
import {newCoachSessionScope,startCoachTurn,receiveCoachResponse,verifyCoachMessageReceipt,switchCoachSessionScope} from "./coachConversationLifecycle.mjs";
const initial=()=>newCoachSessionScope("owner-a",2);
const request={ownerId:"owner-a",sessionGeneration:2,threadId:"thread-1",turnId:"turn-1",clientRequestId:"req-1"};
const response={...request,responseId:"response-1"};
const receipt={...response,messageId:"message-1",ownerVerified:true,readbackVerified:true};
const started=()=>startCoachTurn(initial(),request).state;
const answered=()=>receiveCoachResponse(started(),response).state;
test("new requests carry metadata but no transcript body",()=>{
 const x=startCoachTurn(initial(),request);
 assert.equal(x.kind,"updated");assert.equal(x.turn.status,"requested");
 assert.equal(JSON.stringify(x.state).includes("content"),false);
});
test("exact retries are idempotent while reused IDs for other targets fail",()=>{
 const s=started();
 assert.equal(startCoachTurn(s,request).kind,"unchanged");
 assert.equal(startCoachTurn(s,{...request,threadId:"other"}).reason,"request_id_reused");
 assert.equal(startCoachTurn(s,{...request,clientRequestId:"req-2"}).reason,"turn_id_reused");
});
test("generating a response is not evidence of saving it",()=>{
 const x=receiveCoachResponse(started(),response);
 assert.equal(x.kind,"updated");assert.equal(x.turn.status,"generated_unverified");
 assert.equal(x.turn.saveReceipt,null);
});
test("unexpected, mismatched and conflicting replies are rejected",()=>{
 const s=started();
 assert.equal(receiveCoachResponse(s,{...response,clientRequestId:"alien"}).reason,"unknown_request");
 assert.equal(receiveCoachResponse(s,{...response,threadId:"wrong"}).reason,"response_mismatch");
 assert.equal(receiveCoachResponse(answered(),{...response,responseId:"another"}).reason,"conflicting_response");
});
test("only verified canonical readback produces saved status",()=>{
 const a=answered();assert.equal(verifyCoachMessageReceipt(a,{...receipt,readbackVerified:false}).reason,"unverified_receipt");
 const v=verifyCoachMessageReceipt(a,receipt);
 assert.equal(v.kind,"updated");assert.equal(v.turn.status,"saved_verified");
 assert.equal(v.turn.saveReceipt.messageId,"message-1");
 assert.equal(verifyCoachMessageReceipt(v.state,receipt).kind,"unchanged");
 assert.equal(verifyCoachMessageReceipt(v.state,{...receipt,messageId:"other"}).reason,"conflicting_receipt");
});
test("account change suppresses prior pending responses and saved claims",()=>{
 const a=answered();
 const changed=switchCoachSessionScope(a,"owner-b",3);
 assert.equal(changed.turns.length,0);
 assert.equal(receiveCoachResponse(changed,response).reason,"stale_session");
 assert.equal(verifyCoachMessageReceipt(changed,receipt).reason,"stale_session");
});
test("token/session generation change invalidates in-flight responses",()=>{
 const changed=switchCoachSessionScope(started(),"owner-a",3);
 assert.equal(changed.turns.length,0);
 assert.equal(receiveCoachResponse(changed,response).reason,"stale_session");
});
test("never accept unverifiable session scope",()=>{
 assert.equal(newCoachSessionScope("",0).kind,"blocked");
 assert.equal(newCoachSessionScope("owner",NaN).kind,"blocked");
 assert.equal(startCoachTurn(initial(),{...request,sessionGeneration:3}).reason,"stale_session");
});
test("distinct turns cannot reuse the same persisted message identity",()=>{
 const a=verifyCoachMessageReceipt(answered(),receipt).state;
 const b=startCoachTurn(a,{...request,clientRequestId:"req-2",turnId:"turn-2"}).state;
 const c=receiveCoachResponse(b,{...response,clientRequestId:"req-2",turnId:"turn-2",responseId:"response-2"}).state;
 assert.equal(verifyCoachMessageReceipt(c,{...receipt,clientRequestId:"req-2",turnId:"turn-2",responseId:"response-2"}).reason,"message_id_reused");
});
