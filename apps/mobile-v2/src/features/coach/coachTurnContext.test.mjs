import test from "node:test";
import assert from "node:assert/strict";
import {prepareCoachTurnContext} from "./coachTurnContext.mjs";

const fixture=()=>({
 authenticatedUserId:"a",accountId:"a",accessGateReady:true,threadId:"thread-1",
 currentTime:"2026-11-11T10:11:00Z",
 message:"What should I do with my run today?",restrictionsVerified:true,
 historyCertification:{verified:true,ownerId:"a",sourceRef:"training-read-1",readAt:"2026-11-11T10:10:00Z"},
 history:{
  version:1,generatedAt:"2026-11-11T10:09:00Z",
  requested:{fromDate:"2026-11-01",throughDate:"2026-11-11",sports:["running"]},
  completeness:"partial",warnings:["Device sync incomplete."],
  currentPlan:{id:"plan-1",revision:3,status:"accepted"},
  restrictions:[{id:"r-1",category:"exercise",subject:"lying leg curl",status:"active",source:"explicit_user",updatedAt:"2026-11-10T10:00:00Z"}],
  coverage:[{sport:"running",fromDate:"2026-11-01",throughDate:"2026-11-11",status:"partial",missingIntervals:[]}],
  events:[{id:"event-1",kind:"completed_session",sport:"running",occurredAt:"2026-11-10T09:00:00Z",recordedAt:"2026-11-10T10:00:00Z",source:"canonical_training",canonicalRef:"c1",summary:"Easy road run",confidence:"high"}]
 }
});
test("exact owner-certified context stays read-only and coverage-aware",()=>{
 const x=prepareCoachTurnContext(fixture());
 assert.equal(x.kind,"ready");assert.equal(x.noWriteAuthority,true);
 assert.equal(x.incompleteHistory,true);assert.equal(x.acceptedPlan.revision,3);
 assert.equal(x.activeRestrictions[0].subject,"lying leg curl");
 assert.ok(x.warnings.some(w=>w.includes("zero activity")));
});
test("mismatched account and missing access fail closed",()=>{
 const a=fixture();a.accountId="b";assert.equal(prepareCoachTurnContext(a).reason,"account_mismatch");
 const b=fixture();b.accessGateReady=false;assert.equal(prepareCoachTurnContext(b).reason,"access_gate_required");
});
test("uncertified owner and unverified restrictions cannot be used",()=>{
 const a=fixture();a.historyCertification.ownerId="b";assert.equal(prepareCoachTurnContext(a).reason,"history_owner_unverified");
 const b=fixture();b.restrictionsVerified=false;assert.equal(prepareCoachTurnContext(b).reason,"restrictions_unverified");
});
test("bad plan and untrusted future data are blocked",()=>{
 const a=fixture();a.history.currentPlan.revision=0;assert.equal(prepareCoachTurnContext(a).reason,"plan_invalid");
 const b=fixture();b.history.generatedAt="2026-11-12T10:00:00Z";assert.equal(prepareCoachTurnContext(b).reason,"history_future_snapshot");
});
test("unknown/empty activity is never falsely labeled complete",()=>{
 const a=fixture();a.history.events=[];a.history.completeness="unavailable";
 const x=prepareCoachTurnContext(a);
 assert.equal(x.kind,"ready");assert.equal(x.incompleteHistory,true);
});
test("canonical facts are projected without mutation rights or raw metrics",()=>{
 const x=prepareCoachTurnContext(fixture());
 assert.deepEqual(Object.keys(x.relevantHistory[0]),["id","kind","sport","occurredAt","source","canonicalRef","summary","confidence"]);
 assert.equal(x.noWriteAuthority,true);
});
test("conversation references remain separately conversation-only",()=>{
 const a=fixture();a.message="What did you recommend last time for my run?";
 a.recentLimit=1;
 a.conversationRows=[
  {role:"assistant",content:"I recommend a gentle run.",accountId:"a",threadId:"thread-1",createdAt:"2026-11-10T10:00:00Z"},
  {role:"user",content:"Thanks",accountId:"a",threadId:"thread-1",createdAt:"2026-11-11T10:00:00Z"}
 ];
 const x=prepareCoachTurnContext(a);assert.equal(x.kind,"ready");
 assert.equal(x.priorConversation.authority,"conversation_only");
});
test("invalid conversation collection and malformed restrictions are rejected",()=>{
 const a=fixture();a.conversationRows={fake:true};
 assert.equal(prepareCoachTurnContext(a).reason,"conversation_invalid");
 const b=fixture();b.history.restrictions[0].subject="";
 assert.equal(prepareCoachTurnContext(b).reason,"restrictions_invalid");
});

test("impossible calendar dates fail safely instead of throwing",()=>{
 const a=fixture();a.history.requested.fromDate="2026-13-01";
 assert.equal(prepareCoachTurnContext(a).reason,"history_invalid");
 const b=fixture();b.history.coverage[0].throughDate="2026-02-30";
 assert.equal(prepareCoachTurnContext(b).reason,"coverage_invalid");
});

test("stale, future, or missing clock evidence fails closed",()=>{
 const a=fixture();a.currentTime="2026-11-11T10:30:01Z";
 assert.equal(prepareCoachTurnContext(a).reason,"history_stale");
 const b=fixture();b.currentTime="2026-11-11T10:09:00Z";
 assert.equal(prepareCoachTurnContext(b).reason,"history_future_read");
 const c=fixture();delete c.currentTime;
 assert.equal(prepareCoachTurnContext(c).reason,"history_future_read");
});
