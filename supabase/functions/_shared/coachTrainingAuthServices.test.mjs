import test from "node:test";
import assert from "node:assert/strict";
import {createCoachTrainingAuthServices} from "./coachTrainingAuthServices.mjs";
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const docs=["terms","privacy","founder_beta_terms"].map(k=>({
 document_key:k,version:"v1",title:k,content_markdown:"Reviewed version"}));
const steps=["focus","training_pattern","availability","coach","food_safety","proactivity"];
function fixture(){
 let id=owner;
 const state={profile:{user_id:owner},
  settings:{settings:{training_preferences:{timezone:"America/Chicago"}}},
  required_legal_documents:docs,
  latest_legal_acceptance:{age_18_confirmed:true,terms_version:"v1",
   privacy_version:"v1",founder_beta_terms_version:"v1"},
  onboarding:{completed_steps:steps,skipped_steps:[]}};
 const client={auth:{getUser:async()=>({data:{user:{id}}})},
  rpc:async(name,args)=>name==="v2_my_profile_state"?{data:state}:
   name==="v2_completed_activity_coach_recent_candidate"?{data:{
     ownerId:owner,verified:true,fromDate:args.p_from_date,throughDate:args.p_through_date,
     coverage:"partial_canonical_completed_identity",moreAvailable:false,activities:[]
   }}:{data:{ownerId:owner,verified:true,certifiedRevision:2,restrictions:[]}}};
 return {state,client,swap:()=>{id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
  reader:()=>createCoachTrainingAuthServices({userClient:client,
   bearerToken:"authenticated-test-bearer"})};
}
test("certified legal and timezone read an owner-local date",async()=>{
 const x=fixture(),s=x.reader();
 assert.equal((await s.readAccessGate({ownerId:owner})).ready,true);
 assert.equal(await s.resolveAthleteDate({ownerId:owner,
  readAt:"2026-11-13T02:00:00Z"}),"2026-11-12");
 assert.equal((await s.readRestrictions({ownerId:owner})).certifiedRevision,2);
 const recent=await s.readCompletedHistory({ownerId:owner,
  fromDate:"2026-10-14",throughDate:"2026-11-12"});
 assert.equal(recent.verified,true);
 assert.equal(recent.coverage,"partial_canonical_completed_identity");
});
test("missing consent, onboarding and timezone reject rather than infer",async()=>{
 for(const mutate of [
  s=>{s.latest_legal_acceptance=null},
  s=>{s.onboarding.completed_steps=[]},
  s=>{s.required_legal_documents=[]}
 ]){
  const x=fixture();mutate(x.state);
  assert.equal((await x.reader().readAccessGate({ownerId:owner})).ready,false);
 }
 const x=fixture();delete x.state.settings.settings.training_preferences.timezone;
 await assert.rejects(()=>x.reader().resolveAthleteDate({ownerId:owner,
  readAt:"2026-11-12T19:00:00Z"}),/unavailable/);
});
test("missing restriction certification and account switches block",async()=>{
 const x=fixture();x.client.rpc=async()=>({data:{ownerId:owner,verified:true,restrictions:[]}});
 await assert.rejects(()=>x.reader().readRestrictions({ownerId:owner}),/unavailable/);
 const y=fixture();y.swap();
 await assert.rejects(()=>y.reader().readAccessGate({ownerId:owner}),/unavailable/);
});

test("completed history rejects untrusted owner, missing schema and session switch",async()=>{
 const x=fixture();
 x.client.rpc=async(name,args)=>name==="v2_completed_activity_coach_recent_candidate"?
  {data:{ownerId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
   verified:true,coverage:"partial_canonical_completed_identity",
   fromDate:args.p_from_date,throughDate:args.p_through_date,
   moreAvailable:false,activities:[]}}:{data:x.state};
 await assert.rejects(()=>x.reader().readCompletedHistory({ownerId:owner,
  fromDate:"2026-10-14",throughDate:"2026-11-12"}),/unavailable/);
 const y=fixture();y.swap();
 await assert.rejects(()=>y.reader().readCompletedHistory({ownerId:owner,
  fromDate:"2026-10-14",throughDate:"2026-11-12"}),/unavailable/);
});
