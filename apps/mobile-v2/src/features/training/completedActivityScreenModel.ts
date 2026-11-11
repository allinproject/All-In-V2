/** ALL-243: V1 Overview / Details / Coach screen contract.
 * Pure model only. All presented facts come from the canonical owner input.
 */
import {projectCompletedActivityDetail,type MetricEvidence,type StructuredEvidence,type DetailProjection} from './completedActivityDetailProjection.ts';
import {v1SportBaseline} from './v1CompletedActivityBaseline.ts';
import type {MetricLayout,LayoutMetric} from './completedActivityLayouts.ts';

export type CompletedActivityTab='Overview'|'Details'|'Coach';
export type CompletedActivityCoachEvidence={
 summary:string;
 reasons:readonly string[];
 /** This is interpretation from Coach, not a metric, diagnosis or plan mutation. */
 source:'coach'|'verified_rule';
};
export type CompletedActivityScreenInput={
 id:string;sport:string;terrain?:'road'|'trail'|null;title:string;completedAt:string;
 sourceLabel:string;metrics:readonly MetricEvidence[];sections?:readonly StructuredEvidence[];
 overviewLayout?:MetricLayout;detailsLayout?:MetricLayout;
 coach?:CompletedActivityCoachEvidence|null;
};
export type CompletedActivityScreenModel={
 id:string;sport:string;terrain:'road'|'trail'|null;sportLabel:string;title:string;completedAt:string;sourceLabel:string;
 tabs:readonly CompletedActivityTab[];
 stats:DetailProjection;
 /** No measurements in this metadata; interactive controls must never silently edit source facts. */
 customization:{overview:LayoutMetric[];details:LayoutMetric[]};
 coach:CompletedActivityCoachEvidence|null;
};
const text=(value:string)=>typeof value==='string'&&value.trim().length>0&&value.length<=300;
export function buildCompletedActivityScreenModel(input:CompletedActivityScreenInput):CompletedActivityScreenModel{
 if(!text(input.id)||!text(input.title)||!text(input.completedAt)||!text(input.sourceLabel))
  throw new Error('Completed activity identity or source is unavailable.');
 const sport=v1SportBaseline(input.sport);
 if(!sport)throw new Error('Completed activity sport is not recognized.');
 const stats=projectCompletedActivityDetail(input);
 // Eligible customization candidates are ONLY source-backed values provided by
 // the canonical owner; hidden values are editable without manufacturing metrics.
 const seen=new Set<string>();
 const all:LayoutMetric[]=[];
 for(const metric of input.metrics){
  if(!metric?.key||!metric?.label||!metric?.value||!metric?.source||seen.has(metric.key))continue;
  if(!stats.details.some(x=>x.key===metric.key)&&!stats.hiddenMetricKeys.includes(metric.key))continue;
  seen.add(metric.key);all.push({key:metric.key,label:metric.label,required:metric.required});
 }
 // Both tabs allow editing any available source-backed metric; Overview
 // presents only V1 defaults plus user-pinned additions by default.
 const eligibleOverview=all;
 const coach=input.coach&&text(input.coach.summary)&&
 (input.coach.source==='coach'||input.coach.source==='verified_rule')?
 {summary:input.coach.summary,reasons:input.coach.reasons.filter(text).slice(0,8),source:input.coach.source}:null;
 return {id:input.id,sport:input.sport,terrain:input.terrain??null,sportLabel:sport.label,title:input.title,completedAt:input.completedAt,
  sourceLabel:input.sourceLabel,tabs:['Overview','Details','Coach'],stats,
  customization:{overview:eligibleOverview,details:all},coach};
}
