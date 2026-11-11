/** ALL-244 EventHub: owner-certified eligibility for projecting ONE existing
 * athlete-approved Community workout post into ONE canonical joined event.
 * Pure policy only: this does not publish, create an event, or authorize reads.
 * The EventHub server reader MUST independently enforce membership, audience,
 * blocks and an exact canonical workout/post link for each recipient.
 */
export type EventHubCandidate={
  eventId:string;groupId:string;athleteId:string;
  joinedAt:string;eventLocalDay:string;eventTimezone:string;
  acceptedSportKinds:readonly string[];
};
export type EventHubShareEvidence={
  athleteId:string;canonicalPostId:string;canonicalWorkoutId:string;
  /** Explicitly approved Community publication, not an imported history row. */
  postedAfterExplicitApproval:boolean;
  postAudience:'public'|'followers'|'private';
  /** UTC publish instant plus server-certified event-local dates; do not infer local date from UTC. */
  publishedAt:string;publishedLocalDay:string;workoutLocalDay:string;
  workoutSportKind:string;
  /** If user explicitly chose a group, no other group may be selected. */
  explicitlyLinkedGroupId:string|null;
  /** A user-requested suppression persists across imports/re-tagging. */
  optedOutGroupIds:readonly string[];
  /** Explicit organizer/event-day confirmation for a post after race day. */
  confirmedEventDayWorkout:boolean;
};
export type EventHubCandidateBatch={
  athleteId:string;
  complete:boolean;nextCursor:string|null;
  candidates:readonly EventHubCandidate[];
};
export type EventHubProjectionDecision={
  status:'eligible'|'not_eligible'|'review_required';
  groupId:string|null;
  reason:string;
};
const valid=(v:unknown,max=200)=>typeof v==='string'&&v.length>0&&v===v.trim()&&v.length<=max;
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const instant=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&
  Number.isFinite(Date.parse(v));
function requireEvidence(e:EventHubShareEvidence,b:EventHubCandidateBatch):void{
 if(!valid(e.athleteId)||!valid(e.canonicalPostId)||!valid(e.canonicalWorkoutId)||
  !valid(e.workoutSportKind)||!day(e.workoutLocalDay)||!day(e.publishedLocalDay)||!instant(e.publishedAt)||
  !['public','followers','private'].includes(e.postAudience)||
  typeof e.postedAfterExplicitApproval!=='boolean'||
  typeof e.confirmedEventDayWorkout!=='boolean'||
  !(e.explicitlyLinkedGroupId===null||valid(e.explicitlyLinkedGroupId))||
  !Array.isArray(e.optedOutGroupIds)||e.optedOutGroupIds.some(x=>!valid(x))||
  b.athleteId!==e.athleteId||!b.complete||b.nextCursor!==null||
  !Array.isArray(b.candidates)||b.candidates.length>1000)
  throw new Error('Incomplete or invalid canonical EventHub share evidence.');
 const seen=new Set<string>();
 for(const c of b.candidates){
  if(!valid(c.eventId)||!valid(c.groupId)||!valid(c.athleteId)||
   c.athleteId!==e.athleteId||!instant(c.joinedAt)||
   !day(c.eventLocalDay)||!valid(c.eventTimezone)||
   !Array.isArray(c.acceptedSportKinds)||c.acceptedSportKinds.length>20||
   c.acceptedSportKinds.some(x=>!valid(x))||seen.has(c.groupId))
   throw new Error('Foreign, duplicate or invalid EventHub candidate.');
  seen.add(c.groupId);
 }
}
export function eventHubWorkoutProjection(
  evidence:EventHubShareEvidence,batch:EventHubCandidateBatch,
):EventHubProjectionDecision{
 requireEvidence(evidence,batch);
 const no=(reason:string):EventHubProjectionDecision=>({status:'not_eligible',groupId:null,reason});
 if(!evidence.postedAfterExplicitApproval)
  return no('Community post was not explicitly approved by the athlete.');
 if(evidence.postAudience==='private')
  return no('Private workout posts must not enter an EventHub shared feed.');
 const candidates=batch.candidates.filter(c=>{
  if(evidence.optedOutGroupIds.includes(c.groupId))return false;
  if(evidence.explicitlyLinkedGroupId!==null&&c.groupId!==evidence.explicitlyLinkedGroupId)return false;
  if(!c.acceptedSportKinds.includes(evidence.workoutSportKind))return false;
  if(Date.parse(evidence.publishedAt)<Date.parse(c.joinedAt))return false;
  if(evidence.workoutLocalDay>c.eventLocalDay)return false;
  // A post after event day is never auto-syndicated. A late reviewed
  // event-day workout needs explicit group linkage and human confirmation.
  const afterEventDay=evidence.publishedLocalDay>c.eventLocalDay;
  if(afterEventDay&&!(
   evidence.explicitlyLinkedGroupId===c.groupId&&
   evidence.workoutLocalDay===c.eventLocalDay&&
   evidence.confirmedEventDayWorkout
  ))return false;
  return true;
 });
 if(candidates.length===0)return no('No exact joined, opted-in and sport-compatible EventHub group.');
 if(candidates.length>1)
  return {status:'review_required',groupId:null,
   reason:'Multiple eligible EventHub groups require explicit athlete selection.'};
 return {status:'eligible',groupId:candidates[0].groupId,
  reason:'One existing explicitly approved Community workout post may be projected.'};
}
