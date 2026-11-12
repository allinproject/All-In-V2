/**
 * ALL-217. Per-request server Auth/profile/read helpers for canonical Training
 * context. Uses v2_my_profile_state, not JWT user_metadata, browser time, or
 * request JSON. Missing accepted legal docs/onboarding/timezone blocks Coach.
 */
const uuid=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const required=["terms","privacy","founder_beta_terms"];
const steps=["focus","training_pattern","availability","coach","food_safety","proactivity"];
const fail=()=>{throw Error("coach_authenticated_training_unavailable")};
export function createCoachTrainingAuthServices({userClient,bearerToken}={}){
 if(typeof userClient?.auth?.getUser!=="function"||
   typeof userClient?.rpc!=="function"||
   typeof bearerToken!=="string"||bearerToken.length<8)
  throw Error("coach_authenticated_training_not_configured");
 const verifySession=async()=>{
  const {data,error}=await userClient.auth.getUser(bearerToken);
  if(error||!uuid(data?.user?.id))fail();
  return {id:data.user.id};
 };
 const profileState=async ownerId=>{
  if(!uuid(ownerId)||(await verifySession()).id!==ownerId)fail();
  const {data,error}=await userClient.rpc("v2_my_profile_state");
  if(error||!data||data.profile?.user_id!==ownerId)fail();
  if((await verifySession()).id!==ownerId)fail();
  return data;
 };
 const legalAndOnboardingReady=state=>{
  const docs=state.required_legal_documents,a=state.latest_legal_acceptance;
  if(!Array.isArray(docs)||docs.length!==3||!a||
    a.age_18_confirmed!==true)return false;
  const keys=new Set();
  for(const doc of docs){
   if(!required.includes(doc?.document_key)||
      typeof doc.version!=="string"||!doc.version.trim()||
      typeof doc.title!=="string"||!doc.title.trim()||
      typeof doc.content_markdown!=="string"||!doc.content_markdown.trim())return false;
   keys.add(doc.document_key);
   if(a[doc.document_key+"_version"]!==doc.version)return false;
  }
  if(keys.size!==3)return false;
  const onboarding=state.onboarding;
  if(!onboarding||!Array.isArray(onboarding.completed_steps)||
     !Array.isArray(onboarding.skipped_steps))return false;
  const finished=new Set([...onboarding.completed_steps,...onboarding.skipped_steps]);
  return steps.every(step=>finished.has(step));
 };
 return {
  verifySession,
  readAccessGate:async({ownerId}={})=>{
   const state=await profileState(ownerId);
   return {ownerId,ready:legalAndOnboardingReady(state)};
  },
  readCompletedHistory:async({ownerId,fromDate,throughDate}={})=>{
   if(!uuid(ownerId)||(await verifySession()).id!==ownerId||
      !/^\d{4}-\d{2}-\d{2}$/.test(fromDate??"")||
      !/^\d{4}-\d{2}-\d{2}$/.test(throughDate??""))fail();
   const {data,error}=await userClient.rpc("v2_completed_activity_coach_recent_candidate",{
    p_expected_user_id:ownerId,p_from_date:fromDate,
    p_through_date:throughDate
   });
   if(error||!data||data.ownerId!==ownerId||data.verified!==true||
      data.fromDate!==fromDate||data.throughDate!==throughDate||
      data.coverage!=="partial_canonical_completed_identity"||
      !Array.isArray(data.activities)||data.activities.length>50||
      typeof data.moreAvailable!=="boolean")fail();
   if((await verifySession()).id!==ownerId)fail();
   return data;
  },
  readRestrictions:async({ownerId}={})=>{
   if(!uuid(ownerId)||(await verifySession()).id!==ownerId)fail();
   const {data,error}=await userClient.rpc("v2_training_active_restrictions_read_candidate",{
    p_expected_user_id:ownerId
   });
   if(error||data?.ownerId!==ownerId||data?.verified!==true||
      !Number.isSafeInteger(data.certifiedRevision)||
      data.certifiedRevision<1||!Array.isArray(data.restrictions))fail();
   if((await verifySession()).id!==ownerId)fail();
   return data;
  },
  resolveAthleteDate:async({ownerId,readAt}={})=>{
   const state=await profileState(ownerId);
   // The Training owner must record an IANA zone. Never substitute server UTC
   // or infer a user's local day from IP, device headers, or conversation.
   const zone=state.settings?.settings?.training_preferences?.timezone;
   if(typeof zone!=="string"||zone.length>100||!Number.isFinite(Date.parse(readAt)))fail();
   let parts;
   try{
    parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,
     year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(readAt));
   }catch{fail()}
   const get=k=>parts.find(p=>p.type===k)?.value;
   const date=[get("year"),get("month"),get("day")].join("-");
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail();
   return date;
  }
 };
}
