/** ALL-243 canonical Completed Activity read boundary.
 * This consumes an owner-verified DTO from an approved canonical activity reader.
 * It deliberately does not name or call an unapproved Supabase RPC or introduce
 * a second activity store. The backend must enforce RLS/expected-owner checks.
 */
import {resolveActivityPresentationSport} from './completedActivitySportAdapter.ts';
import type {CompletedActivityScreenInput} from './completedActivityScreenModel.ts';
import type {MetricEvidence,StructuredEvidence,StructuredKind} from './completedActivityDetailProjection.ts';

export type CanonicalMetricDefinition={
 code:string;version:number;displayName:string;canonicalUnit:string|null;
 sportScope:readonly string[];
 measurementKinds:readonly ('source_measured'|'provider_derived'|'user_reported'|'allin_derived'|'estimated')[];
};
export type CanonicalActivityMetric={
 code:string;definitionVersion:number;
 /** Formatted by an authorized, versioned display-unit adapter; null is unknown. */
 displayValue:string|null;
 measurementKind:'source_measured'|'provider_derived'|'user_reported'|'allin_derived'|'estimated';
 sourceId:string;quality:'trusted'|'partial'|'unverified'|'low_quality'|'rejected';
};
export type CanonicalActivitySource={
 id:string;provider:string;quality:'trusted'|'partial'|'unverified'|'low_quality'|'rejected';
};
export type CanonicalActivitySection={
 key:string;kind:StructuredKind;title:string;sourceId:string;count:number;
};
export type CanonicalCompletedActivityRead={
 id:string;ownerId:string;version:number;sport:string;sportSubtype?:string|null;title:string;
 completedAt:string;primarySourceId:string;
 sources:readonly CanonicalActivitySource[];
 definitions:readonly CanonicalMetricDefinition[];
 metrics:readonly CanonicalActivityMetric[];
 sections?:readonly CanonicalActivitySection[];
};
/** Backend owner adapter may use RPCs once ALL-222/243 schema/security approval is recorded. */
export type CompletedActivityCanonicalReader=(args:{activityId:string;expectedOwnerId:string})=>Promise<CanonicalCompletedActivityRead>;
export type CurrentOwnerReader=()=>Promise<string|null>;
const code=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=150&&/^[a-z0-9][a-z0-9._:-]*$/i.test(x);
const text=(x:unknown,max=300):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const qualities=new Set(['trusted','partial','unverified','low_quality','rejected']);
const kinds=new Set(['source_measured','provider_derived','user_reported','allin_derived','estimated']);
const structuredKinds=new Set(['route','splits','laps','intervals','heart_rate_series','power_series',
 'cadence_series','elevation_series','speed_series','strength_sets','swim_sets','machine_series',
 'sport_legs','transitions','other']);
// V1 locked sport-specific screens prohibit an outdoor route on these
// machine/pool-only identities. This is a display integrity guard, not GPS
// ingest validation: a separate real outdoor source requires an appropriately
// classified canonical activity before its route can be presented.
const routeIneligibleSports=new Set(['pool_swim','indoor_trainer','elliptical','stairs']);
// These have unambiguous owning sport identities in the approved V1 Details
// contract. Hybrid activities can contain distinct source-backed sport legs.
// Other sections remain under the canonical owner/source evidence contract;
// do not infer their absence merely from an unfamiliar sport subtype.
const sectionSportScopes:Partial<Record<StructuredKind,ReadonlySet<string>>> = {
 strength_sets:new Set(['strength','hiit','hybrid']),
 swim_sets:new Set(['pool_swim','swim','open_water_swim','hybrid']),
 sport_legs:new Set(['hybrid']),
 transitions:new Set(['hybrid']),
};

function assertCurrent(isCurrent:()=>boolean){
 if(!isCurrent())throw new Error('Completed Activity view is no longer active.');
}
function assertOwner(actual:string|null,expected:string){
 if(!actual||actual!==expected)throw new Error('Completed Activity account changed; reopen the activity.');
}
function evidenceKind(kind:CanonicalActivityMetric['measurementKind']):MetricEvidence['provenance']{
 switch(kind){
  case 'source_measured':return 'device';
  case 'provider_derived':return 'provider';
  case 'user_reported':return 'manual';
  case 'allin_derived':return 'derived';
  case 'estimated':return 'estimated';
 }
}
export function canonicalActivityToScreenInput(raw:CanonicalCompletedActivityRead,expectedOwner:string,activityId:string):CompletedActivityScreenInput{
 if(raw.ownerId!==expectedOwner||raw.id!==activityId||!Number.isSafeInteger(raw.version)||raw.version<1)
  throw new Error('Canonical activity identity could not be verified.');
 const display=resolveActivityPresentationSport(raw.sport,raw.sportSubtype);
 if(!text(raw.title)||!text(raw.completedAt,100))
  throw new Error('Canonical activity type or summary is invalid.');
 if(raw.sources.length>50||raw.definitions.length>1200||raw.metrics.length>1000||(raw.sections?.length??0)>300)
  throw new Error('Canonical activity evidence exceeds read limits.');
 const sources=new Map<string,CanonicalActivitySource>();
 for(const source of raw.sources){
  if(!code(source.id)||!text(source.provider,100)||!qualities.has(source.quality)||sources.has(source.id))
   throw new Error('Invalid or duplicate canonical source.');
  sources.set(source.id,source);
 }
 const primary=sources.get(raw.primarySourceId);
 if(!primary||primary.quality==='rejected')throw new Error('Canonical activity source is unavailable.');
 const definitions=new Map<string,CanonicalMetricDefinition>();
 for(const def of raw.definitions){
  if(!code(def.code)||!Number.isSafeInteger(def.version)||def.version<1||!text(def.displayName,120)||
   !Array.isArray(def.sportScope)||!def.sportScope.length||!def.sportScope.every(code)||
   !Array.isArray(def.measurementKinds)||!def.measurementKinds.length||
   !def.measurementKinds.every(kind=>kinds.has(kind)))
   throw new Error('Invalid metric registry definition.');
  const id=def.code+':'+def.version;
  if(definitions.has(id))throw new Error('Duplicate metric registry definition.');
  definitions.set(id,def);
 }
 const metrics:MetricEvidence[]=[];
 const seenCodes=new Set<string>();
 for(const m of raw.metrics){
  if(!code(m.code)||!Number.isSafeInteger(m.definitionVersion)||m.definitionVersion<1||
   !text(m.sourceId)||!sources.has(m.sourceId)||!qualities.has(m.quality)||!kinds.has(m.measurementKind))
   throw new Error('Unverifiable metric source or definition.');
  const definition=definitions.get(m.code+':'+m.definitionVersion);
  if(!definition||!(definition.sportScope.includes(raw.sport)||definition.sportScope.includes(display.sport))||
   !definition.measurementKinds.includes(m.measurementKind))
   throw new Error('Metric definition does not allow this activity and evidence.');
  if(seenCodes.has(m.code))throw new Error('Conflicting canonical values require upstream reconciliation.');
  seenCodes.add(m.code);
  const source=sources.get(m.sourceId)!;
  if(m.quality==='rejected'||source.quality==='rejected')continue;
  // Null is unknown, but a source-supported measured zero ("0") is legitimate.
  if(m.displayValue===null)continue;
  if(!text(m.displayValue,120)||/^(?:nan|[-+]?infinity|null|undefined)$/i.test(m.displayValue.trim()))
   throw new Error('Invalid source-backed display value.');
  // Do not promote unverified/low-quality measurements into validated facts.
  if(m.quality==='unverified'||m.quality==='low_quality'||
   source.quality==='unverified'||source.quality==='low_quality')continue;
  metrics.push({key:m.code,label:definition.displayName,value:m.displayValue,
   source:source.provider,provenance:evidenceKind(m.measurementKind),
   quality:m.quality,sourceQuality:source.quality,
   ...(definition.canonicalUnit?{unit:definition.canonicalUnit}:{})});
 }
 const sections:StructuredEvidence[]=[];
 for(const section of raw.sections??[]){
  const source=sources.get(section.sourceId);
  if(!source||source.quality!=='trusted'||!code(section.key)||!text(section.title,120)||
   !Number.isSafeInteger(section.count)||section.count<1||!structuredKinds.has(section.kind))
   throw new Error('Structured activity evidence is not verifiable.');
  if(section.kind==='route'&&routeIneligibleSports.has(display.sport))
   throw new Error('Route evidence is incompatible with the canonical activity sport.');
  const allowedSports=sectionSportScopes[section.kind];
  if(allowedSports&&!allowedSports.has(display.sport))
   throw new Error('Structured evidence is incompatible with the canonical activity sport.');
  sections.push({key:section.key,kind:section.kind,title:section.title,source:source.provider,count:section.count});
 }
 return {id:raw.id,sport:display.sport,terrain:display.terrain,title:raw.title,completedAt:raw.completedAt,
  sourceLabel:primary.provider,metrics,sections};
}
/** Guards both ends of asynchronous read, including account switches during the request. */
export async function readOwnedCompletedActivity(
 expectedOwnerId:string,activityId:string,currentOwner:CurrentOwnerReader,
 reader:CompletedActivityCanonicalReader,isCurrent:()=>boolean=()=>true,
):Promise<CompletedActivityScreenInput>{
 if(!text(expectedOwnerId,150)||!text(activityId,150))throw new Error('Activity and owner are required.');
 assertCurrent(isCurrent);
 assertOwner(await currentOwner(),expectedOwnerId);
 assertCurrent(isCurrent);
 const result=await reader({activityId,expectedOwnerId});
 assertCurrent(isCurrent);
 assertOwner(await currentOwner(),expectedOwnerId);
 assertCurrent(isCurrent);
 return canonicalActivityToScreenInput(result,expectedOwnerId,activityId);
}
