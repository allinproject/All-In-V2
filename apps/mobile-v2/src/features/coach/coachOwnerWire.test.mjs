import test from "node:test";
import assert from "node:assert/strict";
import {decodeCoachAppendReceipt,decodeCoachExchangeRows,decodeCoachTranscriptPage} from "./coachOwnerWire.mjs";
const req={ownerId:"owner-a",threadId:"thread-a",clientRequestId:"request-a",userMessageId:"msg-u",assistantMessageId:"msg-a"};
const receipt={ok:true,thread_id:"thread-a",client_request_id:"request-a",user_message_id:"msg-u",assistant_message_id:"msg-a"};
const rows=[
{message_id:"msg-u",user_id:"owner-a",thread_id:"thread-a",client_request_id:"request-a",role:"user",content:"Hello"},
{message_id:"msg-a",user_id:"owner-a",thread_id:"thread-a",client_request_id:"request-a",role:"assistant",content:"Hi"}
];
test("SQL append receipt needs exact IDs before mapping",()=>{
 assert.equal(decodeCoachAppendReceipt(receipt,req).ok,true);
 assert.equal(decodeCoachAppendReceipt({...receipt,assistant_message_id:"other"},req),null);
});
test("owner-read exchange requires explicit account and request on each row",()=>{
 const decoded=decodeCoachExchangeRows(rows,req);
 assert.equal(decoded.length,2);
 assert.equal(decoded[1].ownerId,"owner-a");
 assert.equal(decodeCoachExchangeRows(rows.map(({user_id,...rest})=>rest),req),null);
 assert.equal(decodeCoachExchangeRows(rows.map(({client_request_id,...rest})=>rest),req),null);
});
test("wrong owner, thread, role, or duplicate identity never confirms save",()=>{
 for(const changed of [
 [...rows.slice(0,1),{...rows[1],user_id:"owner-b"}],
 [...rows.slice(0,1),{...rows[1],thread_id:"other"}],
 [...rows.slice(0,1),{...rows[1],role:"user"}],
 [rows[0],rows[0]]
 ])assert.equal(decodeCoachExchangeRows(changed,req),null);
});
test("transcript page requires verified owner tags and descending chronology",()=>{
 const page=[
 {message_id:"msg-a",user_id:"owner-a",thread_id:"thread-a",role:"assistant",content:"Hi",created_at:"2026-11-11T10:00:01Z"},
 {message_id:"msg-u",user_id:"owner-a",thread_id:"thread-a",role:"user",content:"Hello",created_at:"2026-11-11T10:00:00Z"}
 ];
 assert.equal(decodeCoachTranscriptPage(page,req).length,2);
 assert.equal(decodeCoachTranscriptPage([...page].reverse(),req),null);
 assert.equal(decodeCoachTranscriptPage(page.map(x=>({...x,user_id:"owner-b"})),req),null);
});
test("transcript can't be inferred when SQL reader omits owner ID",()=>{
 const publicRows=[{message_id:"msg-a",thread_id:"thread-a",role:"assistant",content:"Hi",created_at:"2026-11-11T10:00:01Z"}];
 assert.equal(decodeCoachTranscriptPage(publicRows,req),null);
});
test("missing and oversized pages fail safely",()=>{
 assert.equal(decodeCoachTranscriptPage(null,req),null);
 assert.equal(decodeCoachTranscriptPage(Array.from({length:51},(_,i)=>({message_id:String(i),user_id:"owner-a",thread_id:"thread-a",role:"assistant",content:"Hi",created_at:"2026-11-11T10:00:00Z"})),req),null);
});
