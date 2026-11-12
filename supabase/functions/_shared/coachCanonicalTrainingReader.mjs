/**
 * ALL-217/232. Reads ONLY the canonical authenticated Training day owner RPC.
 * Missing restrictions, revoked session, or a missing Training schema blocks
 * model admission. No Coach shadow training-history store or fabricated plan.
 * Staging-only until the Training RPC and restrictions owner are deployed.
 */
const uuid=x=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const date=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+"T00:00:00Z"))&&new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
const time=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const die=()=>{throw Error("coach_training_owner_read_unavailable")};
const sports=["running","walking","cycling","swimming","strength","hiking","rucking","rowing","elliptical","stair","yoga","mobility","hiit","multisport","other"];
const categories=["exercise","equipment","schedule","pain_or_return","preference"];
const sources=["explicit_user","approved_plan","system_inferred"];
export function createCoachCanonicalTrainingReader({
 userClient,verifySession,readRestrictions,readAccessGate,resolveAthleteDate
}={}){
 if(typeof userClient?.rpc!=="function"||
    ![verifySession,readRestrictions,readAccessGate,resolveAthleteDate].every(f=>typeof f==="function"))
  throw Error("coach_training_reader_not_configured");
 return async function readContext({ownerId,threadId,readAt}={}){
  if(!uuid(ownerId)||!uuid(threadId)||!time(readAt))die();
  const verify=async()=>{if((await verifySession())?.id!==ownerId)die()};
  await verify();
  const [gate,localDate]=await Promise.all([
   readAccessGate({ownerId}),resolveAthleteDate({ownerId,readAt})
  ]);
  if(gate?.ownerId!==ownerId||gate.ready!==true||!date(localDate))die();
  const [d,r]=await Promise.all([
   userClient.rpc("v2_training_day_read_candidate",{
    p_expected_user_id:ownerId,p_athlete_date:localDate
   }),
   readRestrictions({ownerId,readAt})
  ]);
  await verify();
  if(d?.error||!d?.data||d.data.ownerId!==ownerId||
     d.data.localDate!==localDate||!Array.isArray(d.data.calendarDays)||
     !Array.isArray(d.data.plannedWorkouts)||d.data.calendarDays.length>64||
     d.data.plannedWorkouts.length>128||r?.ownerId!==ownerId||
     r.verified!==true||!Array.isArray(r.restrictions)||
     r.restrictions.length>200)die();
  const revisions=new Set(),days=d.data.calendarDays;
  for(const day of days){
   if(!uuid(day.planId)||!uuid(day.revisionId)||day.localDate!==localDate||
      !["planned","rest","recovery","unavailable","race","review_required"].includes(day.dayState))die();
   revisions.add(day.revisionId);
  }
  const events=d.data.plannedWorkouts.map(w=>{
   if(!uuid(w.sessionId)||!uuid(w.revisionId)||!revisions.has(w.revisionId)||
      !uuid(w.planId)||!date(w.localDate)||w.localDate!==localDate||
      !sports.includes(w.sport)||typeof w.purpose!=="string"||
      w.purpose.trim().length<1||w.purpose.length>500||
      typeof w.sessionKind!=="string"||w.sessionKind.length>100||
      w.intentSchemaVersion!=="session-intent-v1"||
      !w.intent||typeof w.intent!=="object"||Array.isArray(w.intent)||
      JSON.stringify(w.intent).length>32768)die();
   return {id:w.sessionId,kind:"planned_session",sport:w.sport,
    occurredAt:readAt,recordedAt:readAt,source:"canonical_training",
    canonicalRef:w.revisionId,confidence:"verified",
    summary:(w.sessionKind+": "+w.purpose).slice(0,600)};
  });
  const restrictions=r.restrictions.map(rule=>{
   if(!uuid(rule?.id)||!categories.includes(rule.category)||
      !sources.includes(rule.source)||rule.status!=="active"||
      typeof rule.subject!=="string"||!rule.subject.trim()||
      rule.subject.length>200||!time(rule.updatedAt)||
      Date.parse(rule.updatedAt)>Date.parse(readAt))die();
   return {id:rule.id,category:rule.category,subject:rule.subject,
    status:"active",source:rule.source,updatedAt:rule.updatedAt};
  });
  if(new Set(events.map(e=>e.id)).size!==events.length||
     new Set(restrictions.map(e=>e.id)).size!==restrictions.length)die();
  const covered=[...new Set(["running","cycling","strength",...events.map(e=>e.sport)])];
  return {ownerId,accessGateReady:true,restrictionsVerified:true,
   historyCertification:{verified:true,ownerId,
    sourceRef:"canonical-v2-training-day:"+localDate,readAt},
   history:{version:1,generatedAt:readAt,
    requested:{fromDate:localDate,throughDate:localDate,sports:covered},
    completeness:"partial",
    warnings:["Only the authenticated Training calendar day was read; complete workout history and recovery are not yet certified."],
    // Never choose arbitrarily between multiple active plans.
    currentPlan:null,restrictions,
    coverage:covered.map(sport=>({sport,fromDate:localDate,throughDate:localDate,
     status:"partial",missingIntervals:[]})),events}};
 };
}
