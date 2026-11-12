/**
 * ALL-231 — preview envelope for owner-certified multi-event phase decisions.
 * No second Training owner, live reader, or direct plan write.
 */
import {proposeSeasonFromVerifiedTraining} from './multiEventOwnerBridge.ts';
import {certifySeasonAgainstGoalEventOwners,type CanonicalEventGoalApproval} from './canonicalEventGoalApprovalGate.ts';
import {reviewMultiEventPhaseWindows,type EventPhaseDecision,type MultiEventPhaseReview} from './multiEventPhaseReview.ts';
import type {SeasonPlanDraft} from './multiEventSeasonPlan.ts';

type OwnerArgs=Parameters<typeof proposeSeasonFromVerifiedTraining>[0];
export type SeasonPhasePreview=
 | {status:'unavailable';reason:string;draft:null;phases:null}
 | {status:'blocked'|'review_required';reason:null;draft:SeasonPlanDraft;phases:MultiEventPhaseReview;
    ownerId:string;planRevisionId:string;snapshotVersion:string;
    requiresAthleteApproval:true;canWriteAcceptedPlan:false};

/** Re-evaluate both the owner snapshot and event evidence at invocation time. */
export function previewCertifiedSeasonPhases(input:{
 ownerSeason:OwnerArgs;
 expectedPlanRevisionId:string;
 phaseDecisions:readonly EventPhaseDecision[];
}):SeasonPhasePreview{
 const unavailable=(reason:string):SeasonPhasePreview=>({status:'unavailable',reason,draft:null,phases:null});
 if(!input||!input.ownerSeason||typeof input.expectedPlanRevisionId!=='string'||!input.expectedPlanRevisionId.trim())
  return unavailable('missing_revision_or_owner');
 const result=proposeSeasonFromVerifiedTraining(input.ownerSeason);
 if(result.status==='unavailable')return unavailable(result.reason);
 if(result.planRevisionId!==input.expectedPlanRevisionId)
  return unavailable('stale_plan_revision');
 if(result.status==='blocked')return unavailable('conflicting_season_events');
 let phases:MultiEventPhaseReview;
 try{
  phases=reviewMultiEventPhaseWindows({season:result.proposal,decisions:input.phaseDecisions});
 }catch{return unavailable('phase_evidence_invalid');}
 return {status:phases.status,reason:null,draft:result.proposal,phases,
  ownerId:input.ownerSeason.expectedOwnerId,planRevisionId:result.planRevisionId,
  snapshotVersion:result.snapshotVersion,requiresAthleteApproval:true,canWriteAcceptedPlan:false};
}

/** The UI may show this identity only, not claim an apply RPC exists. */
export function seasonPhasePreviewIdentity(preview:SeasonPhasePreview){
 if(preview.status==='unavailable')return null;
 return {ownerId:preview.ownerId,planRevisionId:preview.planRevisionId,
  snapshotVersion:preview.snapshotVersion,requiresAthleteApproval:true as const,
  canWriteAcceptedPlan:false as const};
}

/**
 * Coach-facing certified phase preview. Unlike the Training-only preview,
 * this MUST check authoritative Goal/Event ownership and participation as
 * well as the current accepted Training revision. No database reads/writes.
 */
export function previewGoalEventCertifiedSeasonPhases(input:{
 ownerSeason:OwnerArgs;
 goalEventOwners:CanonicalEventGoalApproval|null;
 expectedPlanRevisionId:string;
 phaseDecisions:readonly EventPhaseDecision[];
}):SeasonPhasePreview{
 const unavailable=(reason:string):SeasonPhasePreview=>({status:'unavailable',reason,draft:null,phases:null});
 if(!input||!input.ownerSeason||!input.goalEventOwners)
  return unavailable('goal_event_owner_evidence_required');
 const approved=certifySeasonAgainstGoalEventOwners(input.ownerSeason,input.goalEventOwners);
 if(approved.status==='unavailable')return unavailable(approved.reason);
 if(approved.status==='blocked')return unavailable('conflicting_goal_event_season');
 const preview=previewCertifiedSeasonPhases(input);
 if(preview.status==='unavailable')return preview;
 if(preview.planRevisionId!==approved.planRevisionId||
    preview.snapshotVersion!==approved.snapshotVersion||
    preview.draft.events.length!==approved.proposal.events.length||
    preview.draft.events.some((e,i)=>{
     const x=approved.proposal.events[i];
     return e.id!==x.id||e.date!==x.date||e.sport!==x.sport||e.priority!==x.priority;
    }))
  return unavailable('goal_event_training_preview_mismatch');
 return preview;
}
