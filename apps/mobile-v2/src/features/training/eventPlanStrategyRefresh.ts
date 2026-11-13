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
