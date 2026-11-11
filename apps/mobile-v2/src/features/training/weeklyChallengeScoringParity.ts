/** ALL-253 / V1 parity fixture, NOT a production scoring authority.
 * Source of truth: V1 allin_private.weekly_challenge_scoring_definition_v1()
 * and weekly_challenge_score_breakdown_v1(), inspected 2026-11-11.
 * A trusted V2 server must recompute scores from canonical evidence and the
 * frozen attempt baseline. NEVER submit this preview as a verified score.
 */
export const WEEKLY_INDOOR_SCORING_VERSION='challenge-score-v1' as const;
export type WeeklyChallengeScoringInputs={
  completionFraction:number|null;
  prescribedExecutionIndex:number|null;
  scoredEffortRelativeToFtp:number|null;
};
export type WeeklyChallengeScoreBreakdown={
 version:typeof WEEKLY_INDOOR_SCORING_VERSION;
 completionFraction:number;
 prescribedExecutionIndex:number;
 scoredEffortRelativeToFtp:number|null;
 completionPoints:number;
 executionPoints:number;
 scoredEffortPoints:number;
 score:number;
};
const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
function validInput(value:number|null):boolean{
 return value===null||(typeof value==='number'&&Number.isFinite(value));
}
function rounded(value:number,places:number):number{
 const factor=10**places;
 // Numeric arithmetic here is only a QA parity approximation, never an
 // authoritative PostgreSQL NUMERIC score or competition tiebreak decision.
 return Math.round((value+Number.EPSILON)*factor)/factor;
}
export function previewV1ScoreForParity(input:WeeklyChallengeScoringInputs):WeeklyChallengeScoreBreakdown{
 if(!validInput(input.completionFraction)||!validInput(input.prescribedExecutionIndex)||
    !validInput(input.scoredEffortRelativeToFtp))throw Error('Invalid V1 scoring fixture input.');
 const completion=clamp01(input.completionFraction??0);
 const execution=clamp01(input.prescribedExecutionIndex??0);
 const effort=clamp01((input.scoredEffortRelativeToFtp??0)/2);
 const completionPoints=rounded(20*completion,3);
 const executionPoints=rounded(30*execution,3);
 const scoredEffortPoints=rounded(50*effort,3);
 return {
  version:WEEKLY_INDOOR_SCORING_VERSION,
  completionFraction:rounded(completion,5),
  prescribedExecutionIndex:rounded(execution,5),
  scoredEffortRelativeToFtp:input.scoredEffortRelativeToFtp===null?null:rounded(input.scoredEffortRelativeToFtp,5),
  completionPoints,executionPoints,scoredEffortPoints,
  score:rounded(20*completion+30*execution+50*effort,3),
 };
}
/** V1 rank ordering contract. The database, not this helper, determines ranks.
 * This frozen ordering is a QA invariant for verified candidate fixtures only.
 */
export type VerifiedAttemptRankFixture={
 attemptId:string;ownerId:string;challengeId:string;
 score:number;scoredEffortRelativeToFtp:number;
 prescribedExecutionIndex:number;completedAt:string;
};
export function compareV1VerifiedAttemptsForParity(a:VerifiedAttemptRankFixture,b:VerifiedAttemptRankFixture):number{
 for(const n of [a.score,b.score,a.scoredEffortRelativeToFtp,b.scoredEffortRelativeToFtp,
  a.prescribedExecutionIndex,b.prescribedExecutionIndex]){
  if(!Number.isFinite(n))throw Error('Invalid verified rank fixture.');
 }
 if(a.challengeId!==b.challengeId||!a.challengeId||!a.ownerId||!b.ownerId||
    !a.attemptId||!b.attemptId)throw Error('Incomparable competition attempts.');
 const aTime=Date.parse(a.completedAt),bTime=Date.parse(b.completedAt);
 if(!Number.isFinite(aTime)||!Number.isFinite(bTime))throw Error('Invalid completion time.');
 return b.score-a.score ||
  b.scoredEffortRelativeToFtp-a.scoredEffortRelativeToFtp ||
  b.prescribedExecutionIndex-a.prescribedExecutionIndex ||
  aTime-bTime ||
  (a.attemptId<b.attemptId?-1:a.attemptId>b.attemptId?1:0);
}
