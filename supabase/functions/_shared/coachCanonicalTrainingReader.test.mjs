import test from "node:test";
import assert from "node:assert/strict";
import {createCoachCanonicalTrainingReader} from "./coachCanonicalTrainingReader.mjs";
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const thread="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const revision="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const session="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const plan="ffffffff-ffff-4fff-8fff-ffffffffffff";
const rule="11111111-1111-4111-8111-111111111111";
const readAt="2026-11-12T19:00:00Z",localDate="2026-11-12";
const day={ownerId:owner,localDate,calendarDays:[{planId:plan,revisionId:revision,localDate,dayState:"planned"}],
 plannedWorkouts:[{planId:plan,revisionId:revision,sessionId:session,localDate,sport:"strength",
 sessionKind:"Legs + abs",purpose:"Four supersets",intentSchemaVersion:"session-intent-v1",intent:{blocks:4}}]};
const restriction={id:rule,category:"exercise",subject:"lying leg curl",source:"explicit_user",status:"active",
 updatedAt:"2026-11-11T00:00:00Z"};
function fixture(){
 let verifies=0,reads=0;
 const deps={
 userClient:{rpc:async(name,params)=>{reads++;assert.equal(name,"v2_training_day_read_candidate");
 assert.equal(params.p_expected_user_id,owner);return {data:structuredClone(day)}}},
 verifySession:async()=>{verifies++;return {id:owner}},
 readRestrictions:async()=>({ownerId:owner,verified:true,restrictions:[restriction]}),
 readCompletedHistory:async({fromDate,throughDate})=>({
  ownerId:owner,verified:true,coverage:"partial_canonical_completed_identity",
  fromDate,throughDate,moreAvailable:false,activities:[{
   activityId:"22222222-2222-4222-8222-222222222222",ownerId:owner,
   sport:"running",localDate:"2026-11-11",status:"completed",kind:"workout",
   captureKind:"device_measured",version:1,
   startedAt:"2026-11-11T10:00:00Z",recordedAt:"2026-11-11T12:00:00Z"
  }]
 }),
 readAccessGate:async()=>({ownerId:owner,ready:true}),
 resolveAthleteDate:async()=>localDate
 };
 return {deps,counts:()=>({verifies,reads}),reader:()=>createCoachCanonicalTrainingReader(deps)};
}
const input={ownerId:owner,threadId:thread,readAt};
test("authenticated Training reader retrieves restrictions and accurately marks partial scope",async()=>{
 const x=fixture(),a=await x.reader()(input);
 assert.deepEqual(x.counts(),{verifies:2,reads:1});
 assert.equal(a.history.events[0].canonicalRef,revision);
 assert.equal(a.history.events[1].kind,"completed_session");
 assert.equal(a.history.events[1].confidence,"verified_identity_only");
 assert.equal(a.history.requested.fromDate,"2026-10-14");
 assert.equal(a.history.restrictions[0].subject,"lying leg curl");
 assert.equal(a.history.completeness,"partial");
 assert.equal(a.history.currentPlan,null);
 assert.equal(a.history.plannedDay.sessions[0].intent.blocks,4);
 assert.equal(a.historyCertification.ownerId,owner);
});
test("a missing restrictions source cannot masquerade as verified empty restrictions",async()=>{
 const x=fixture();x.deps.readRestrictions=async()=>null;
 await assert.rejects(()=>x.reader()(input),/read_unavailable/);
});
test("session switch before or after canonical read fails closed",async()=>{
 for(const early of [true,false]){
  const x=fixture();let n=0;
  x.deps.verifySession=async()=>({id:early||++n===2?other:owner});
  await assert.rejects(()=>x.reader()(input),/read_unavailable/);
 }
});
test("cross-owner responses, absent schema, and missing access gate are refused",async()=>{
 for(const mode of ["day","rules","missing","gate"]){
  const x=fixture();
  if(mode==="day")x.deps.userClient.rpc=async()=>({data:{...day,ownerId:other}});
  if(mode==="rules")x.deps.readRestrictions=async()=>({ownerId:other,verified:true,restrictions:[]});
  if(mode==="missing")x.deps.userClient.rpc=async()=>({error:{code:"42883"}});
  if(mode==="gate")x.deps.readAccessGate=async()=>({ownerId:owner,ready:false});
  await assert.rejects(()=>x.reader()(input),/read_unavailable/);
 }
});
test("missing plan, verified empty day and missing athlete timezone do not invent workouts",async()=>{
 const x=fixture();x.deps.userClient.rpc=async()=>({data:{...day,calendarDays:[],plannedWorkouts:[]}});
 const result=await x.reader()(input);
 assert.equal(result.history.events.length,1);
 assert.equal(result.history.completeness,"partial");
 const bad=fixture();bad.deps.resolveAthleteDate=async()=>"2026-02-30";
 await assert.rejects(()=>bad.reader()(input),/read_unavailable/);
});

test("oversized accepted workout day is blocked rather than silently truncated",async()=>{
 const x=fixture(),long=structuredClone(day);
 long.plannedWorkouts[0].intent={nested:"x".repeat(18000)};
 x.deps.userClient.rpc=async()=>({data:long});
 await assert.rejects(()=>x.reader()(input),/read_unavailable/);
});

test("completed owner history cannot be omitted, spoofed or claim full coverage",async()=>{
 for(const mode of ["missing","owner","coverage","future","repeated"]){
  const x=fixture();
  const prior=x.deps.readCompletedHistory;
  x.deps.readCompletedHistory=async args=>{
   const value=await prior(args);
   if(mode==="missing")return null;
   if(mode==="owner")return {...value,ownerId:other};
   if(mode==="coverage")return {...value,coverage:"complete"};
   if(mode==="future")return {...value,activities:[{...value.activities[0],startedAt:"2026-11-20T00:00:00Z"}]};
   if(mode==="repeated")return {...value,activities:[value.activities[0],value.activities[0]]};
   return value;
  };
  await assert.rejects(()=>x.reader()(input),/read_unavailable/);
 }
});
