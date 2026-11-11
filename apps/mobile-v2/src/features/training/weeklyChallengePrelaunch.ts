/** ALL-253: read-only Weekly Challenge eligibility/pre-launch guard.
 * This is a presentation/input contract, NOT a server result verifier.
 * Only the canonical competition writer can decide or award a ranked result.
 */
export type WeeklyChallengeState='upcoming'|'open'|'closed'|'finalized';
export type PowerEvidence='verified_supported_source'|'pending_verification'|'manual_or_estimated'|'unsupported_source';
export type WeeklyChallengePreview={
  challengeId:string;rulesVersion:string;ownerId:string;
  state:WeeklyChallengeState;startsAt:string;endsAt:string;
  /** Shared authored interval structure; target watts are not shared. */
  commonStructureId:string;
  /** Frozen, owner-specific approved prescription identity. */
  personalizedPrescriptionId:string|null;
  /** Whether this read is backed by a complete owner-certified snapshot. */
  ownerReadComplete:boolean;
  /** Whether physical power-source capability and continuity were checked by server. */
  powerEvidence:PowerEvidence;
  /** Verified source belongs to this owner and the proposed canonical session. */
  sourceOwnerId:string|null;
  sourceSessionId:string|null;
  canonicalSessionId:string|null;
};
export type ChallengePrelaunchDecision={
  canPreview:boolean;canStartTraining:boolean;canEnterVerifiedCompetition:boolean;
  reason:'ready'|'unavailable'|'invalid_identity'|'not_open'|'unverified_power'|'uncertified_source';
};
function validId(value:unknown):value is string{
  return typeof value==='string'&&value.length>0&&value.length<=240&&value.trim()===value;
}
function validDate(value:string):boolean{
  return typeof value==='string'&&Number.isFinite(Date.parse(value))&&/Z$|[+-]\d\d:\d\d$/.test(value);
}
/** Fail closed on stale/cross-owner or contradictory source identity.
 * A non-verified participant may still do the same workout as ordinary training.
 * Starting ALWAYS requires a separate explicit start command.
 */
export function assessWeeklyChallengePrelaunch(
  preview:WeeklyChallengePreview,authenticatedOwnerId:string,nowIso:string,
):ChallengePrelaunchDecision{
  const blocked=(reason:ChallengePrelaunchDecision['reason']):ChallengePrelaunchDecision=>({
    canPreview:false,canStartTraining:false,canEnterVerifiedCompetition:false,reason,
  });
  if(!validId(authenticatedOwnerId)||preview.ownerId!==authenticatedOwnerId||
     !validId(preview.challengeId)||!validId(preview.rulesVersion)||
     !validId(preview.commonStructureId)||!preview.ownerReadComplete)
    return blocked('invalid_identity');
  if(!validDate(preview.startsAt)||!validDate(preview.endsAt)||!validDate(nowIso)||
     Date.parse(preview.startsAt)>=Date.parse(preview.endsAt))
    return blocked('unavailable');
  const within=Date.parse(nowIso)>=Date.parse(preview.startsAt)&&Date.parse(nowIso)<Date.parse(preview.endsAt);
  if(preview.state!=='open'||!within)
    return {canPreview:true,canStartTraining:false,canEnterVerifiedCompetition:false,reason:'not_open'};
  if(!validId(preview.personalizedPrescriptionId))
    return blocked('unavailable');
  if(preview.powerEvidence!=='verified_supported_source')
    return {canPreview:true,canStartTraining:true,canEnterVerifiedCompetition:false,reason:'unverified_power'};
  if(!validId(preview.canonicalSessionId)||!validId(preview.sourceSessionId)||
     preview.sourceSessionId!==preview.canonicalSessionId||
     preview.sourceOwnerId!==authenticatedOwnerId)
    return {canPreview:true,canStartTraining:true,canEnterVerifiedCompetition:false,reason:'uncertified_source'};
  return {canPreview:true,canStartTraining:true,canEnterVerifiedCompetition:true,reason:'ready'};
}
/** Exact attempt comparison only; never rely on arbitrary UI rank or client score
 * to create a verified leaderboard record. Server must recompute eligibility/score.
 */
export function isSameCanonicalChallengeAttempt(
  left:{challengeId:string;ownerId:string;canonicalSessionId:string},
  right:{challengeId:string;ownerId:string;canonicalSessionId:string},
):boolean{
  return validId(left.challengeId)&&validId(left.ownerId)&&validId(left.canonicalSessionId)&&
    left.challengeId===right.challengeId&&left.ownerId===right.ownerId&&
    left.canonicalSessionId===right.canonicalSessionId;
}
