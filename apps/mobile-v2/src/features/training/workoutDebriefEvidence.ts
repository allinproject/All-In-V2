/** ALL-217/232/241: read-only source-backed evidence for original Coach workout analysis. */
import type { AthleteHistoryEvent, AthleteHistoryReadModel } from './athleteHistoryContext.ts';
type Measure='durationMinutes'|'distanceMiles'|'averageHeartRateBpm'|'elevationGainFeet'|'rpe';
const accepted:Record<Measure,[number,number]>={durationMinutes:[0,10080],distanceMiles:[0,1000],averageHeartRateBpm:[20,250],elevationGainFeet:[0,100000],rpe:[0,10]};
export type WorkoutObservation={measure:Measure;value:number;sourceEventId:string};
export type WorkoutComparison={measure:Measure;current:number;prior:number;difference:number;priorEventId:string};
export type WorkoutDebriefEvidence={
 status:'ready'|'insufficient_evidence';sessionId:string;sport:AthleteHistoryEvent['sport']|null;
 summary:string|null;observations:WorkoutObservation[];comparisons:WorkoutComparison[];
 warnings:string[];historyCoverage:AthleteHistoryReadModel['completeness'];
 canonicalRef:string|null;policy:{noInferredCause:true;noAutomaticWrite:true;avoidGenericPraise:true};
};
function readMeasures(e:AthleteHistoryEvent):WorkoutObservation[]{
 return (Object.keys(accepted) as Measure[]).flatMap(measure=>{
  const value=e.metrics[measure];const [min,max]=accepted[measure];
  return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?
   [{measure,value,sourceEventId:e.id}]:[];
 });
}
/** sessionPurpose is an exact canonical tag, never inferred from the summary. */
export function buildWorkoutDebriefEvidence(input:{
 history:AthleteHistoryReadModel;sessionId:string;sessionPurpose?:string|null;
 maxComparisons?:number;
}):WorkoutDebriefEvidence{
 if(!input||!input.history||!Array.isArray(input.history.events)||typeof input.sessionId!=='string'||!input.sessionId.trim())
  throw new Error('Exact session ID and bounded canonical athlete history required.');
 if(input.maxComparisons!==undefined&&(!Number.isSafeInteger(input.maxComparisons)||input.maxComparisons<0||input.maxComparisons>5))
  throw new Error('Invalid comparison limit');
 const {history,sessionId}=input;
 const policy={noInferredCause:true,noAutomaticWrite:true,avoidGenericPraise:true} as const;
 const candidates=history.events.filter(e=>e.id===sessionId&&(e.kind==='completed_session'||e.kind==='strength_session'));
 const session=candidates.length===1?candidates[0]:null;
 const common={sessionId,sport:session?.sport??null,summary:session?.summary??null,
  canonicalRef:session?.canonicalRef??null,historyCoverage:history.completeness,policy};
 if(!session||!session.canonicalRef||session.confidence==='low')
  return {...common,status:'insufficient_evidence',observations:[],comparisons:[],
   warnings:['Confirmed canonical completed-session details unavailable; do not generate a completed-workout interpretation.']};
 const observations=readMeasures(session),warnings=[...history.warnings],comparisons:WorkoutComparison[]=[];
 if(history.completeness!=='complete_for_requested_scope')
  warnings.push('Comparable history coverage incomplete; unrecorded activity remains unknown.');
 const purpose=typeof input.sessionPurpose==='string'?input.sessionPurpose.trim():null;
 if(purpose&&session.metrics.sessionPurpose===purpose&&history.completeness==='complete_for_requested_scope'){
  const previous=history.events.filter(e=>e.id!==sessionId&&
   (e.kind==='completed_session'||e.kind==='strength_session')&&e.sport===session.sport&&
   !!e.canonicalRef&&e.confidence!=='low'&&e.metrics.sessionPurpose===purpose&&
   Date.parse(e.occurredAt)<Date.parse(session.occurredAt))
   .sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
  if(previous)for(const observation of observations){
   const prior=readMeasures(previous).find(x=>x.measure===observation.measure);
   if(prior&&comparisons.length<(input.maxComparisons??3))
    comparisons.push({measure:observation.measure,current:observation.value,prior:prior.value,
     difference:observation.value-prior.value,priorEventId:previous.id});
  }
 }else warnings.push('No verified comparable same-purpose history; do not infer a progress trend.');
 if(!observations.length)warnings.push('No supported numeric measurements; do not invent workout statistics.');
 return {...common,status:'ready',observations,comparisons,warnings};
}
