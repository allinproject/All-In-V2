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
 userClient,verifySession,readRestrictions,readCompletedHistory,readAccessGate,resolveAthleteDate
}={}){
 if(typeof userClient?.rpc!=="function"||
    ![verifySession,readRestrictions,readCompletedHistory,readAccessGate,resolveAthleteDate].every(f=>typeof f==="function"))
  throw Error("coach_training_reader_not_configured");
 return async function readContext({ownerId,threadId,readAt}={}){
  if(!uuid(ownerId)||!uuid(threadId)||!time(readAt))die();
  const verify=async()=>{if((await verifySession())?.id!==ownerId)die()};
  await verify();
  const [gate,localDate]=await Promise.all([
   readAccessGate({ownerId}),resolveAthleteDate({ownerId,readAt})
  ]);
  if(gate?.ownerId!==ownerId||gate.ready!==true||!date(localDate))die();
  const start=new Date(localDate+"T12:00:00Z");
  start.setUTCDate(start.getUTCDate()-29);
  const fromDate=start.toISOString().slice(0,10);
  const [d,r,completed]=await Promise.all([
   userClient.rpc("v2_training_day_read_candidate",{
    p_expected_user_id:ownerId,p_athlete_date:localDate
   }),
   readRestrictions({ownerId,readAt}),
   readCompletedHistory({ownerId,fromDate,throughDate:localDate,readAt})
  ]);
  await verify();
  if(d?.error||!d?.data||d.data.ownerId!==ownerId||
     d.data.localDate!==localDate||!Array.isArray(d.data.calendarDays)||
     !Array.isArray(d.data.plannedWorkouts)||d.data.calendarDays.length>64||
     d.data.plannedWorkouts.length>128||r?.ownerId!==ownerId||
     r.verified!==true||!Array.isArray(r.restrictions)||
     r.restrictions.length>200||completed?.verified!==true||
     completed.ownerId!==ownerId||completed.fromDate!==fromDate||
     completed.throughDate!==localDate||
     completed.coverage!=="partial_canonical_completed_identity"||
     typeof completed.moreAvailable!=="boolean"||
     !Array.isArray(completed.activities)||completed.activities.length>50)die();
  const revisions=new Set(),days=d.data.calendarDays;
  for(const day of days){
   if(!uuid(day.planId)||!uuid(day.revisionId)||day.localDate!==localDate||
      !["planned","rest","recovery","unavailable","race","review_required"].includes(day.dayState))die();
   revisions.add(day.revisionId);
  }
  // Planned sessions remain in plannedDay, never in completed activity
  // history. Assigning readAt as their occurredAt was a false activity signal.
  for(const w of d.data.plannedWorkouts){
   if(!uuid(w.sessionId)||!uuid(w.revisionId)||!revisions.has(w.revisionId)||
      !uuid(w.planId)||!date(w.localDate)||w.localDate!==localDate||
      !sports.includes(w.sport)||typeof w.purpose!=="string"||
      w.purpose.trim().length<1||w.purpose.length>500||
      typeof w.sessionKind!=="string"||w.sessionKind.length>100||
      w.intentSchemaVersion!=="session-intent-v1"||
      !w.intent||typeof w.intent!=="object"||Array.isArray(w.intent)||
      JSON.stringify(w.intent).length>32768)die();
  }
  const completedEvents=completed.activities.map(a=>{
   if(!uuid(a?.activityId)||a.ownerId!==ownerId||
      !sports.includes(a.sport)||!date(a.localDate)||
      a.localDate<fromDate||a.localDate>localDate||
      !["completed","partial","needs_review"].includes(a.status)||
      !["workout","race","competition","manual_entry","free_activity"].includes(a.kind)||
      !["device_measured","provider_import","user_reported","manual_only","mixed_sources"].includes(a.captureKind)||
      !Number.isSafeInteger(a.version)||a.version<1||
      !time(a.recordedAt))die();
   const occurredAt=a.startedAt??a.finishedAt??a.recordedAt;
   if(!time(occurredAt)||Date.parse(occurredAt)>Date.parse(readAt)||
      Date.parse(a.recordedAt)>Date.parse(readAt)||
      Date.parse(occurredAt)>Date.parse(a.recordedAt))die();
   return {id:a.activityId,kind:a.status==="completed"?
     "completed_session":"partial_or_unreviewed_session",
    sport:a.sport,occurredAt,recordedAt:a.recordedAt,
    source:"canonical_completed_activity_identity",
    canonicalRef:a.activityId,confidence:a.status==="completed"?
     "verified_identity_only":"partial_identity_only",
    summary:a.status==="completed"?
     "Recorded "+a.sport+" "+a.kind+" (metrics not certified)":
     "Unconfirmed "+a.sport+" "+a.kind+" (review required)"};
  });
  // Preserve the accepted session-intent data exactly. The purpose string
  // alone cannot represent exercise order, pairings, rounds or prescription.
  // Bound the entire model-facing slice rather than silently dropping blocks.
  if(d.data.plannedWorkouts.length>8)die();
  const sessions=d.data.plannedWorkouts.map(w=>({
   planId:w.planId,revisionId:w.revisionId,sessionId:w.sessionId,
   localDate:w.localDate,sport:w.sport,sessionKind:w.sessionKind,
   purpose:w.purpose,intentSchemaVersion:w.intentSchemaVersion,intent:w.intent
  }));
  if(JSON.stringify(sessions).length>16000)die();
  const plannedDay={localDate,
   calendarDays:days.map(day=>({planId:day.planId,
    revisionId:day.revisionId,dayState:day.dayState})),
   sessions,verified:true};
  const restrictions=r.restrictions.map(rule=>{
   if(!uuid(rule?.id)||!categories.includes(rule.category)||
      !sources.includes(rule.source)||rule.status!=="active"||
      typeof rule.subject!=="string"||!rule.subject.trim()||
      rule.subject.length>200||!time(rule.updatedAt)||
      Date.parse(rule.updatedAt)>Date.parse(readAt))die();
   return {id:rule.id,category:rule.category,subject:rule.subject,
    status:"active",source:rule.source,updatedAt:rule.updatedAt};
  });
  if(new Set(completedEvents.map(e=>e.id)).size!==completedEvents.length||
     new Set(d.data.plannedWorkouts.map(w=>w.sessionId)).size!==d.data.plannedWorkouts.length||
     new Set(restrictions.map(e=>e.id)).size!==restrictions.length)die();
  const covered=[...new Set(["running","cycling","strength",
   ...d.data.plannedWorkouts.map(w=>w.sport),...completedEvents.map(e=>e.sport)])];
  return {ownerId,accessGateReady:true,restrictionsVerified:true,
   historyCertification:{verified:true,ownerId,
    sourceRef:"canonical-v2-training-and-completed:"+localDate,readAt},
   history:{version:1,generatedAt:readAt,
    requested:{fromDate,throughDate:localDate,sports:covered},
    completeness:"partial",
    warnings:["This is a partial recent Completed Activity identity slice plus today's accepted Training calendar; full synced history, performance metrics and recovery are not yet certified.",
     ...(completed.moreAvailable?["Additional completed activities exist outside the bounded 50-record read."]:[])],
    // Never choose arbitrarily between multiple active plans.
    currentPlan:null,plannedDay,restrictions,
    coverage:covered.map(sport=>({sport,fromDate,throughDate:localDate,
     status:"partial",missingIntervals:[]})),events:completedEvents}};
 };
}
