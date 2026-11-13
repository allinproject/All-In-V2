/**
 * ALL-234/246: read-only strategy freshness decision. Automatic regeneration
 * is advisory only; accepted Training plans and race execution packages
 * remain guarded by the existing canonical reviewed Apply flow.
 */
export type StrategyEventRef={
  ownerId:string;eventId:string;editionId:string;eventVersion:number;
};
export type StrategySourceRevision=StrategyEventRef&{
  sourceRevision:number;
  courseVersion:string|null;
  evidenceState:'verified'|'partial'|'unverified'|'conflict';
};
export type EventStrategySnapshot=StrategyEventRef&{
  strategyRevision:number;
  sourceRevision:number;
  courseVersion:string|null;
};
export type StrategyRefreshDecision=
 | {status:'unavailable';reason:'missing_or_mismatched_event'|'invalid_revision'}
 | {status:'source_review_required';reason:'unverified_or_conflicting_source'|'source_revision_regressed'}
 | {status:'current';reason:'same_source'}
 | {status:'refresh_advice';reason:'new_source'|'course_changed';invalidateCourseDependentAdvice:boolean;requiresTrainingApproval:true};

function validRef(ref:StrategyEventRef):boolean{
  return typeof ref.ownerId==='string'&&!!ref.ownerId.trim()&&
    typeof ref.eventId==='string'&&!!ref.eventId.trim()&&
    typeof ref.editionId==='string'&&!!ref.editionId.trim()&&
    Number.isSafeInteger(ref.eventVersion)&&ref.eventVersion>0;
}
function sameRef(a:StrategyEventRef,b:StrategyEventRef):boolean{
  return a.ownerId===b.ownerId&&a.eventId===b.eventId&&
    a.editionId===b.editionId&&a.eventVersion===b.eventVersion;
}
function validCourseVersion(v:unknown):v is string|null{
  return v===null||(typeof v==='string'&&!!v.trim());
}
export function reviewEventStrategySourceRefresh(input:{
  expected:StrategyEventRef;
  current:EventStrategySnapshot|null;
  incoming:StrategySourceRevision|null;
}):StrategyRefreshDecision{
  const {expected,current,incoming}=input;
  if(!expected||!validRef(expected)||!current||!incoming||
    !validRef(current)||!validRef(incoming)||
    !sameRef(expected,current)||!sameRef(expected,incoming))
    return{status:'unavailable',reason:'missing_or_mismatched_event'};
  if(!Number.isSafeInteger(current.strategyRevision)||current.strategyRevision<1||
    !Number.isSafeInteger(current.sourceRevision)||current.sourceRevision<1||
    !Number.isSafeInteger(incoming.sourceRevision)||incoming.sourceRevision<1||
    !validCourseVersion(current.courseVersion)||!validCourseVersion(incoming.courseVersion))
    return{status:'unavailable',reason:'invalid_revision'};
  if(!['verified','partial','unverified','conflict'].includes(incoming.evidenceState)||
    incoming.evidenceState!=='verified')
    return{status:'source_review_required',reason:'unverified_or_conflicting_source'};
  if(incoming.sourceRevision<current.sourceRevision)
    return{status:'source_review_required',reason:'source_revision_regressed'};
  if(incoming.sourceRevision===current.sourceRevision){
    if(incoming.courseVersion!==current.courseVersion)
      return{status:'source_review_required',reason:'unverified_or_conflicting_source'};
    return{status:'current',reason:'same_source'};
  }
  return{
    status:'refresh_advice',
    reason:incoming.courseVersion===current.courseVersion?'new_source':'course_changed',
    invalidateCourseDependentAdvice:incoming.courseVersion!==current.courseVersion,
    requiresTrainingApproval:true,
  };
}

/**
 * Compare a returned Coach advisory result against the CURRENT authoritative
 * event/source and strategy revisions. Late async responses must not overwrite
 * newer advice or accidentally accept changes to canonical Training.
 *
 * A caller may display a matching advisory preview; persisting any strategy
 * requires a separately authorized owner writer with compare-and-swap.
 */
export type EventStrategyGenerationReceipt=StrategyEventRef&{
  basedOnStrategyRevision:number;
  basedOnSourceRevision:number;
  basedOnCourseVersion:string|null;
  adviceText:string;
};
export type EventStrategyResponseReview=
 | {status:'unavailable';reason:'event_mismatch'|'invalid_receipt'}
 | {status:'stale';reason:'source_changed'|'strategy_advanced'}
 | {status:'review_ready';adviceText:string;requiresTrainingApproval:true};

export function reviewEventStrategyGenerationReceipt(input:{
  expected:StrategyEventRef;
  current:EventStrategySnapshot|null;
  latestSource:StrategySourceRevision|null;
  receipt:EventStrategyGenerationReceipt|null;
}):EventStrategyResponseReview {
  const {expected,current,latestSource,receipt}=input;
  if(!expected||!validRef(expected)||!current||!latestSource||!receipt||
    !validRef(current)||!validRef(latestSource)||!validRef(receipt)||
    !sameRef(expected,current)||!sameRef(expected,latestSource)||
    !sameRef(expected,receipt))
    return {status:'unavailable',reason:'event_mismatch'};
  if(!Number.isSafeInteger(current.strategyRevision)||current.strategyRevision<1||
    !Number.isSafeInteger(current.sourceRevision)||current.sourceRevision<1||
    !Number.isSafeInteger(latestSource.sourceRevision)||latestSource.sourceRevision<1||
    !Number.isSafeInteger(receipt.basedOnStrategyRevision)||receipt.basedOnStrategyRevision<1||
    !Number.isSafeInteger(receipt.basedOnSourceRevision)||receipt.basedOnSourceRevision<1||
    !validCourseVersion(current.courseVersion)||!validCourseVersion(latestSource.courseVersion)||
    !validCourseVersion(receipt.basedOnCourseVersion)||
    latestSource.evidenceState!=='verified'||typeof receipt.adviceText!=='string'||
    !receipt.adviceText.trim())
    return {status:'unavailable',reason:'invalid_receipt'};
  if(latestSource.sourceRevision<current.sourceRevision)
    return {status:'stale',reason:'source_changed'};
  if(receipt.basedOnSourceRevision!==latestSource.sourceRevision||
     receipt.basedOnCourseVersion!==latestSource.courseVersion)
    return {status:'stale',reason:'source_changed'};
  if(receipt.basedOnStrategyRevision!==current.strategyRevision)
    return {status:'stale',reason:'strategy_advanced'};
  return {status:'review_ready',adviceText:receipt.adviceText,requiresTrainingApproval:true};
}

/**
 * Prepare an idempotent, authenticated refresh *intent* for the owning Coach
 * service. This never calls a provider or writes canonical Event/Training data.
 * Source and strategy snapshots must still originate from certified owners.
 */
export type EventStrategyRefreshIntent=StrategyEventRef&{
  requestKey:string;
  authSessionGeneration:number;
  expectedStrategyRevision:number;
  sourceRevision:number;
  courseVersion:string|null;
  invalidateCourseDependentAdvice:boolean;
  requiresTrainingApproval:true;
};
export type EventStrategyRefreshIntentResult=
 |{status:'unavailable';reason:'not_authenticated'|'invalid_session'}
 |{status:'not_requested';reason:'missing_or_mismatched_event'|'invalid_revision'|
   'unverified_or_conflicting_source'|'source_revision_regressed'|'same_source'}
 |{status:'ready';intent:EventStrategyRefreshIntent};

export function prepareEventStrategyRefreshIntent(input:{
  expected:StrategyEventRef;
  authenticatedOwnerId:string|null;
  authSessionGeneration:number;
  accessGateReady:boolean;
  current:EventStrategySnapshot|null;
  incoming:StrategySourceRevision|null;
}):EventStrategyRefreshIntentResult{
  if(!input.accessGateReady||!input.authenticatedOwnerId||
    input.authenticatedOwnerId!==input.expected?.ownerId)
    return{status:'unavailable',reason:'not_authenticated'};
  if(!Number.isSafeInteger(input.authSessionGeneration)||input.authSessionGeneration<0)
    return{status:'unavailable',reason:'invalid_session'};
  const decision=reviewEventStrategySourceRefresh(input);
  if(decision.status!=='refresh_advice')
    return{status:'not_requested',reason:decision.reason};
  const current=input.current!;
  const incoming=input.incoming!;
  // JSON tuple avoids ambiguous concatenation when owner IDs or course
  // versions contain punctuation. Same certified revisions deduplicate.
  const requestKey=JSON.stringify([
    input.expected.ownerId,input.expected.eventId,input.expected.editionId,
    input.expected.eventVersion,input.authSessionGeneration,
    current.strategyRevision,incoming.sourceRevision,incoming.courseVersion,
  ]);
  return{status:'ready',intent:{
    ...input.expected,
    requestKey,
    authSessionGeneration:input.authSessionGeneration,
    expectedStrategyRevision:current.strategyRevision,
    sourceRevision:incoming.sourceRevision,
    courseVersion:incoming.courseVersion,
    invalidateCourseDependentAdvice:decision.invalidateCourseDependentAdvice,
    requiresTrainingApproval:true,
  }};
}
