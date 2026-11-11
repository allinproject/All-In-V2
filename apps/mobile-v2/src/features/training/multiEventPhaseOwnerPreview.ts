/**
 * ALL-231 — preview envelope for owner-certified multi-event phase decisions.
 * No second Training owner, live reader, or direct plan write.
 */
import {proposeSeasonFromVerifiedTraining} from './multiEventOwnerBridge.ts';
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
