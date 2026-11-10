/**
 * V2 Coach read-model contract for queryable athlete history.
 * This module does not fetch or persist history; canonical owner readers do.
 * Its purpose is to retain provenance, active constraints and coverage gaps
 * when building a bounded Coach context.
 */
export type AthleteHistorySport='running'|'cycling'|'swimming'|'strength'|'hiking'|'rucking'|'rowing'|'elliptical'|'stair'|'yoga'|'mobility'|'other';
export type AthleteHistorySource='canonical_training'|'device_import'|'manual_entry'|'race_result';
export type AthleteHistoryCoverageStatus='complete'|'partial'|'none'|'unknown';
export type AthleteHistoryEvent={
 id:string;
 kind:'completed_session'|'race_result'|'strength_session'|'plan_change'|'adaptation_outcome';
 sport:AthleteHistorySport|null;
 occurredAt:string;
 recordedAt:string;
 source:AthleteHistorySource;
 sourceRef:string|null;
 canonicalRef:string|null;
 planId:string|null;
 planRevision:number|null;
 summary:string;
 metrics:Record<string,number|string|boolean|null>;
 confidence:'low'|'moderate'|'high';
};
export type AthleteHistoryCoverage={
 sport:AthleteHistorySport;
 fromDate:string;
 throughDate:string;
 status:AthleteHistoryCoverageStatus;
 lastSyncAt:string|null;
 missingIntervals:Array<{fromDate:string;throughDate:string;reason:string}>;
};
export type AthleteRestriction={
 id:string;
 category:'exercise'|'equipment'|'schedule'|'pain_or_return'|'preference';
 subject:string;
 status:'active'|'inactive';
 source:'explicit_user'|'approved_plan'|'system_inferred';
 updatedAt:string;
 reason:string|null;
};
export type AthleteHistoryReadModel={
 version:1;
 generatedAt:string;
 requested:{fromDate:string;throughDate:string;sports:AthleteHistorySport[]};
 currentPlan:{id:string;revision:number;weekStart:string;status:'accepted'}|null;
 restrictions:AthleteRestriction[];
 coverage:AthleteHistoryCoverage[];
 events:AthleteHistoryEvent[];
 completeness:'complete_for_requested_scope'|'partial'|'unavailable';
 warnings:string[];
};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function validDate(value:string):boolean{
 if(typeof value!=='string'||!DATE.test(value))return false;
 const parsed=new Date(value+'T12:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function timestamp(value:string):number{const n=Date.parse(value);return Number.isFinite(n)?n:0}
function safeEvent(e:AthleteHistoryEvent):boolean{
 return Boolean(e&&typeof e.id==='string'&&e.id.trim()&&typeof e.summary==='string'&&e.summary.trim()&&
 typeof e.occurredAt==='string'&&Number.isFinite(Date.parse(e.occurredAt))&&validDate(e.occurredAt.slice(0,10))&&
 typeof e.recordedAt==='string'&&Number.isFinite(Date.parse(e.recordedAt))&&
 ['canonical_training','device_import','manual_entry','race_result'].includes(e.source)&&
 ['low','moderate','high'].includes(e.confidence)&&e.metrics&&typeof e.metrics==='object'&&!Array.isArray(e.metrics)&&
 Object.values(e.metrics).every(value=>value===null||typeof value==='string'||typeof value==='boolean'||
  (typeof value==='number'&&Number.isFinite(value))));
}
export function buildAthleteHistoryReadModel(input:{
 generatedAt:string;fromDate:string;throughDate:string;sports:AthleteHistorySport[];
 currentPlan:AthleteHistoryReadModel['currentPlan'];
 restrictions:AthleteRestriction[];coverage:AthleteHistoryCoverage[];events:AthleteHistoryEvent[];
 maxEvents?:number;
}):AthleteHistoryReadModel{
 if(!Number.isFinite(Date.parse(input.generatedAt))||!validDate(input.fromDate)||!validDate(input.throughDate)||input.fromDate>input.throughDate||
    !Array.isArray(input.sports)||input.sports.length===0||!Array.isArray(input.restrictions)||!Array.isArray(input.coverage)||!Array.isArray(input.events)||
    (input.maxEvents!==undefined&&(!Number.isSafeInteger(input.maxEvents)||input.maxEvents<1)))
  throw new Error('Valid athlete-history scope, sport selection, collections and retrieval timestamp are required.');
 const sports=[...new Set(input.sports)];
 const coverage=input.coverage.filter(c=>Boolean(c&&sports.includes(c.sport)&&validDate(c.fromDate)&&validDate(c.throughDate)&&c.fromDate<=c.throughDate&&
   ['complete','partial','none','unknown'].includes(c.status)&&Array.isArray(c.missingIntervals)));
 const requestedStart=Date.parse(input.fromDate+'T00:00:00Z'),requestedEnd=Date.parse(input.throughDate+'T23:59:59Z');
 const relevantCoverage=coverage.filter(c=>sports.includes(c.sport));
 // Conflicting source intervals cannot be merged into a fabricated 'complete'
 // history. A complete report for a sport must span the requested window AND
 // have no competing partial, unknown or missing-interval coverage record.
 const coveredSports=new Set(sports.filter(sport=>{
   const reports=relevantCoverage.filter(c=>c.sport===sport);
   return reports.some(c=>c.status==='complete'&&Date.parse(c.fromDate+'T00:00:00Z')<=requestedStart&&Date.parse(c.throughDate+'T23:59:59Z')>=requestedEnd&&c.missingIntervals.length===0)&&
     reports.every(c=>c.status==='complete'&&c.missingIntervals.length===0);
 }));
 const complete=sports.length>0&&sports.every(s=>coveredSports.has(s));
 const anyCoverage=relevantCoverage.some(c=>c.status!=='none');
 const warnings:string[]=[];
 if(!complete)warnings.push('History is incomplete for at least one requested sport or date range. Do not treat missing records as zero activity.');
 if(relevantCoverage.some(c=>c.status==='partial'||c.missingIntervals.length>0))warnings.push('One or more device/provider history intervals are missing.');
 if(relevantCoverage.some(c=>c.status==='unknown'))warnings.push('History coverage is unknown for one or more sports.');
 if(input.currentPlan&&(!Number.isInteger(input.currentPlan.revision)||input.currentPlan.revision<1))throw new Error('Current accepted Training plan revision is invalid.');
 // Active hard constraints must never disappear because their reader returned
 // a partial or malformed record. Require the owner to refresh/fix that read.
 if(input.restrictions.some(r=>r&&r.status==='active'&&(
    typeof r.id!=='string'||!r.id.trim()||typeof r.subject!=='string'||!r.subject.trim()||
    !['exercise','equipment','schedule','pain_or_return','preference'].includes(r.category)||
    !['explicit_user','approved_plan','system_inferred'].includes(r.source)||
    typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt))
  )))throw new Error('An active athlete restriction is incomplete. Refresh canonical restrictions before Coach plans.');
 const restrictions=input.restrictions.filter(r=>r&&r.status==='active').sort((a,b)=>timestamp(b.updatedAt)-timestamp(a.updatedAt));
 const events=input.events.filter(safeEvent).filter(e=>e.occurredAt.slice(0,10)>=input.fromDate&&e.occurredAt.slice(0,10)<=input.throughDate&&(!e.sport||sports.includes(e.sport)));
 const max=Math.max(1,Math.min(100,Math.floor(input.maxEvents??50)));
 events.sort((a,b)=>timestamp(b.occurredAt)-timestamp(a.occurredAt)||timestamp(b.recordedAt)-timestamp(a.recordedAt));
 return{
  version:1,generatedAt:input.generatedAt,requested:{fromDate:input.fromDate,throughDate:input.throughDate,sports},
  currentPlan:input.currentPlan,restrictions,coverage:relevantCoverage,events:events.slice(0,max),
  completeness:complete?'complete_for_requested_scope':anyCoverage?'partial':'unavailable',
  warnings,
 };
}
