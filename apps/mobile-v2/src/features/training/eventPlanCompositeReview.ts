/**
 * ALL-239/244/246 — view-only validation of the proposed canonical
 * EventHub + Goals composite owner read. NOT an auth certificate, data store,
 * network reader, or a substitute for PostgreSQL RLS and server-side CAS.
 * This never maps Goal 'primary' to fabricated race A/B/C priority.
 */
export type CanonicalCompositeEvent = {
  ownerId:string;eventId:string;editionId:string;eventVersion:number;
  name:string;date:string|null;timezone:string|null;sport:string;
  verification:string;participation:string;participationSource:string;
  cancelled:boolean;
};
export type CanonicalCompositeGoal = {
  goalId:string;goalKind:string;goalStatus:string;
  activeRevisionId:string|null;revisionStatus:string|null;
  priorityRole:string|null;eventId:string|null;editionId:string|null;
  boundEventVersion:number|null;
};
export type CanonicalEventGoalComposite = {
  ownerId:string;complete:boolean;nextCursor:null;
  status:'owner_sources_complete'|'review_required';
  eventSnapshotVersion:string;goalSnapshotVersion:string;
  events:readonly CanonicalCompositeEvent[];
  goals:readonly CanonicalCompositeGoal[];
  eventRegistrationInferred:false;trainingPlanApproved:false;
};
export type CanonicalCompositeReview =
 | {status:'unavailable'|'review_required';reason:string;events:null}
 | {status:'review_ready';eventSnapshotVersion:string;goalSnapshotVersion:string;
    events:{event:CanonicalCompositeEvent;acceptedGoals:CanonicalCompositeGoal[]}[]};

function validDate(v:string|null):boolean {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+'T12:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
/**
 * Re-check on every account/session transition and after every fresh DB
 * response. The transport must be independently authenticated, and the
 * server must supply the composite in a single authorized read.
 */
export function reviewCanonicalEventGoalComposite(input:{
  expectedOwnerId:string;authenticatedOwnerId:string|null;
  sessionGeneration:number;accessGateReady:boolean;
  serverOwnerReadReady:boolean;composite:CanonicalEventGoalComposite|null;
}):CanonicalCompositeReview {
  const blocked=(status:'unavailable'|'review_required',reason:string):CanonicalCompositeReview=>
    ({status,reason,events:null});
  const {composite:c}=input;
  if(!input.accessGateReady||!input.serverOwnerReadReady||
     !input.expectedOwnerId?.trim()||
     input.authenticatedOwnerId!==input.expectedOwnerId||
     !Number.isSafeInteger(input.sessionGeneration)||input.sessionGeneration<0||
     !c||c.ownerId!==input.expectedOwnerId||
     c.complete!==true||c.nextCursor!==null||
     c.eventRegistrationInferred!==false||c.trainingPlanApproved!==false||
     !c.eventSnapshotVersion?.trim()||!c.goalSnapshotVersion?.trim()||
     !Array.isArray(c.events)||!Array.isArray(c.goals))
    return blocked('unavailable','owner_or_composite_unavailable');
  if(c.status!=='owner_sources_complete')
    return blocked('review_required','canonical_source_review_required');
  const events=new Map<string,CanonicalCompositeEvent>();
  for(const e of c.events) {
    if(!e||e.ownerId!==input.expectedOwnerId||!e.eventId?.trim()||
       !e.editionId?.trim()||events.has(e.eventId)||
       !Number.isSafeInteger(e.eventVersion)||e.eventVersion<1||
       !e.name?.trim()||!e.sport?.trim()||!e.timezone?.trim()||
       !validDate(e.date)||e.verification!=='organizer_verified'||
       e.cancelled!==false||
       !['interested','registered','attended','completed','withdrawn'].includes(e.participation)||
       !['athlete_confirmed','organizer_verified'].includes(e.participationSource))
      return blocked('review_required','event_identity_or_provenance_incomplete');
    events.set(e.eventId,e);
  }
  const byEvent=new Map<string,CanonicalCompositeGoal[]>();
  const goalIds=new Set<string>();
  for(const g of c.goals) {
    if(!g||!g.goalId?.trim()||goalIds.has(g.goalId))
      return blocked('review_required','invalid_or_repeated_goal');
    goalIds.add(g.goalId);
    if(g.eventId===null){
      if(g.editionId!==null||g.boundEventVersion!==null)
        return blocked('review_required','partial_goal_event_binding');
      continue;
    }
    if(g.goalKind!=='race_event'||g.goalStatus!=='active'||
       g.revisionStatus!=='accepted'||
       !g.activeRevisionId?.trim()||
       !['primary','secondary','maintenance','optional'].includes(g.priorityRole??''))
      return blocked('review_required','goal_binding_not_accepted');
    const e=events.get(g.eventId);
    if(!e||g.editionId!==e.editionId||g.boundEventVersion!==e.eventVersion)
      return blocked('review_required','goal_event_revision_conflict');
    byEvent.set(e.eventId,[...(byEvent.get(e.eventId)??[]),g]);
  }
  return {status:'review_ready',
    eventSnapshotVersion:c.eventSnapshotVersion,goalSnapshotVersion:c.goalSnapshotVersion,
    events:[...events.values()]
      .sort((a,b)=>a.date!.localeCompare(b.date!)||a.eventId.localeCompare(b.eventId))
      .map(event=>({event,acceptedGoals:byEvent.get(event.eventId)??[]})),
  };
}
