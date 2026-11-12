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
 assert.equal(a.history.restrictions[0].subject,"lying leg curl");
 assert.equal(a.history.completeness,"partial");
 assert.equal(a.history.currentPlan,null);
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
 assert.equal(result.history.events.length,0);
 assert.equal(result.history.completeness,"partial");
 const bad=fixture();bad.deps.resolveAthleteDate=async()=>"2026-02-30";
 await assert.rejects(()=>bad.reader()(input),/read_unavailable/);
});
