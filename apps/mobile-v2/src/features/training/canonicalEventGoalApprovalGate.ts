/**
 * ALL-222/239/244/246: release-boundary certification for a proposed
 * Training season. Data must come from the REAL Goal/Event owners.
 * This does not fetch, persist, certify a website, register an athlete,
 * or grant permission to accept a Training revision.
 */
import {proposeSeasonFromVerifiedTraining} from './multiEventOwnerBridge.ts';
type SeasonInput=Parameters<typeof proposeSeasonFromVerifiedTraining>[0];
type OwnerEventEvidence={
  eventId:string; ownerId:string; eventVersion:number;
  date:string; timezone:string; sport:string;
  verification:'organizer_verified'|'partial'|'unverified';
  participation:'registered'|'athlete_confirmed'|'none'|'group_member';
  evidenceGeneration:number;
};
type OwnerGoalEvidence={
  goalId:string;ownerId:string;goalRevisionId:string;goalVersion:number;
  status:'accepted'|'draft'|'archived';
  targetEventId:string|null;
  startDate:string|null;targetDate:string|null;
};
export type CanonicalEventGoalApproval={
  /** Exact revision-session version retained by the canonical Training owner.
   * These are verified read receipts, not user-supplied URL matches. */
  bindingSnapshot:{ownerId:string;authSessionGeneration:number;complete:boolean;
    nextCursor:string|null;snapshotVersion:string;
    bindings:readonly {eventId:string;eventVersion:number;eventTimezone:string;
      planRevisionId:string;sessionId:string}[]};
  eventSnapshot:{ownerId:string;authSessionGeneration:number;complete:boolean;
    nextCursor:string|null;snapshotVersion:string;events:readonly OwnerEventEvidence[]};
  goalSnapshot:{ownerId:string;authSessionGeneration:number;complete:boolean;
    nextCursor:string|null;snapshotVersion:string;goals:readonly OwnerGoalEvidence[]};
};
export type CertifiedSeasonResult=
 |{status:'unavailable';reason:string;proposal:null}
 |{status:'review_required'|'blocked';reason:null;
   proposal:Exclude<ReturnType<typeof proposeSeasonFromVerifiedTraining>,{status:'unavailable'}>['proposal'];
   planRevisionId:string;snapshotVersion:string};
const validDate=(v:string|null):boolean=>v===null||
  typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v+'T12:00:00Z'))&&
  new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
/** Cross-domain gate; only authoritative snapshots can pass. No client-supplied
 * EventHub URL/group membership is event registration or race certification.
 */
export function certifySeasonAgainstGoalEventOwners(
 input:SeasonInput,owners:CanonicalEventGoalApproval|null,
):CertifiedSeasonResult {
 const no=(reason:string):CertifiedSeasonResult=>({status:'unavailable',reason,proposal:null});
 if(!owners||!input||!input.accessGateReady||
    input.authenticatedOwnerId!==input.expectedOwnerId||
    !input.expectedOwnerId?.trim()||
    !Number.isSafeInteger(input.activeSessionGeneration)||input.activeSessionGeneration<0)
  return no('owner_snapshot_not_certified');
 const snapshots=[owners.eventSnapshot,owners.goalSnapshot,owners.bindingSnapshot];
 if(snapshots.some(s=>!s||s.ownerId!==input.expectedOwnerId||
    s.authSessionGeneration!==input.activeSessionGeneration||
    !s.complete||s.nextCursor!==null||!s.snapshotVersion?.trim()))
  return no('owner_snapshot_incomplete_or_stale');
 if(!Array.isArray(owners.eventSnapshot.events)||!Array.isArray(owners.goalSnapshot.goals)||
    !Array.isArray(owners.bindingSnapshot.bindings))
  return no('owner_records_invalid');
 if(owners.eventSnapshot.snapshotVersion!==owners.goalSnapshot.snapshotVersion||
    owners.eventSnapshot.snapshotVersion!==owners.bindingSnapshot.snapshotVersion||
    owners.eventSnapshot.snapshotVersion!==input.daySnapshot?.snapshotVersion||
    owners.eventSnapshot.snapshotVersion!==input.plannedSnapshot?.snapshotVersion||
    owners.eventSnapshot.snapshotVersion!==input.competitionSnapshot?.snapshotVersion)
  return no('cross_owner_versions_disagree');
 const events=new Map<string,OwnerEventEvidence>();
 for(const e of owners.eventSnapshot.events){
  if(!e||!e.eventId?.trim()||events.has(e.eventId)||
    e.ownerId!==input.expectedOwnerId||!Number.isSafeInteger(e.eventVersion)||e.eventVersion<1||
    !validDate(e.date)||!e.date||!e.timezone?.includes('/')||
    e.verification!=='organizer_verified'||e.evidenceGeneration!==input.activeSessionGeneration||
    !['registered','athlete_confirmed'].includes(e.participation))
   return no('event_not_owner_certified');
  events.set(e.eventId,e);
 }
 const goals=new Map<string,OwnerGoalEvidence>();
 for(const g of owners.goalSnapshot.goals){
  if(!g||!g.goalId?.trim()||goals.has(g.goalId)||
     g.ownerId!==input.expectedOwnerId||!g.goalRevisionId?.trim()||
     !Number.isSafeInteger(g.goalVersion)||g.goalVersion<1||
     !validDate(g.startDate)||!validDate(g.targetDate)||
     (g.startDate!==null&&g.targetDate!==null&&g.startDate>g.targetDate))
   return no('goal_not_owner_certified');
  goals.set(g.goalId,g);
 }
 const bindings=new Map<string,{eventId:string;eventVersion:number;eventTimezone:string;
   planRevisionId:string;sessionId:string}>();
 for(const binding of owners.bindingSnapshot.bindings){
  if(!binding||!binding.eventId?.trim()||bindings.has(binding.eventId)||
    binding.planRevisionId!==input.activePlanRevisionId||
    !binding.sessionId?.trim()||!Number.isSafeInteger(binding.eventVersion)||
    binding.eventVersion<1||!binding.eventTimezone?.includes('/'))
   return no('training_event_version_binding_invalid');
  bindings.set(binding.eventId,binding);
 }
 const referenced=new Set<string>();
 for(const event of input.events){
  const e=events.get(event.id);
  const b=bindings.get(event.id);
  const committed=input.competitionSnapshot?.records.find(c=>c.eventId===event.id);
  if(!e||!b||e.date!==event.date||e.sport!==event.sport||
    b.eventVersion!==e.eventVersion||b.eventTimezone!==e.timezone||
    !committed||b.sessionId!==committed.sessionId||
    b.planRevisionId!==committed.planRevisionId)
   return no('event_identity_or_version_stale');
  referenced.add(e.eventId);
 }
 if(events.size!==referenced.size||bindings.size!==referenced.size)
  return no('unexpected_or_missing_owner_event');
 const bound=new Set<string>();
 for(const g of goals.values()){
  if(g.targetEventId!==null){
   if(!events.has(g.targetEventId)||g.status!=='accepted')
    return no('goal_event_binding_stale');
   bound.add(g.targetEventId);
  }
 }
 if([...referenced].some(id=>!bound.has(id)))
  return no('missing_accepted_goal_event_binding');
 const season=proposeSeasonFromVerifiedTraining(input);
 return season;
}
