/** ALL-243: read-only Completed Activity presentation projection.
 * Input MUST be normalized by the future canonical activity metric/source owner.
 * Never synthesizes an absent metric, series, route, split or strength set.
 * Does not perform ingest, plan mutation, source verification or storage.
 */
import {v1AllDetailsMetrics,v1SportBaseline} from './v1CompletedActivityBaseline.ts';
import {presentMetrics,type LayoutMetric,type MetricLayout} from './completedActivityLayouts.ts';

export type MetricEvidence=LayoutMetric&{
 value:string;
 provenance:'device'|'provider'|'manual'|'derived'|'estimated';
 source:string;
 unit?:string;
 /** Keep owner-certified data quality for Details/Coach display; a partially
  * verified measurement must not appear indistinguishable from trusted data.
  * Optional for legacy presentation-only fixtures; canonical reads supply it.
  */
 quality?:'trusted'|'partial';
 sourceQuality?:'trusted'|'partial';
};
/** Display-only quality warning. Never upgrades an estimated or partially
 * verified source into a trusted sensor reading. Legacy source-only evidence
 * has no confidence claim and therefore receives no invented quality badge. */
export function metricEvidenceQualityNotice(metric:MetricEvidence):string|null{
 const warnings:string[]=[];
 // Every value derived, estimated or manually reported must retain its
 // evidence kind on Overview too; the source label alone can describe a mixed
 // activity's primary recorder rather than this individual metric.
 switch(metric.provenance){
  case 'estimated':warnings.push('Estimated value');break;
  case 'derived':warnings.push('Calculated value');break;
  case 'provider':warnings.push('Provider-derived value');break;
  case 'manual':warnings.push('Manually entered value');break;
 }
 if(metric.quality==='partial'&&metric.sourceQuality==='partial')
  warnings.push('Partial measurement and source quality');
 else if(metric.quality==='partial')warnings.push('Partial measurement quality');
 else if(metric.sourceQuality==='partial')warnings.push('Partial source quality');
 return warnings.length?warnings.join(' · '):null;
}
export type StructuredKind='route'|'splits'|'laps'|'intervals'|'heart_rate_series'|
 'power_series'|'cadence_series'|'elevation_series'|'speed_series'|
 'strength_sets'|'swim_sets'|'machine_series'|'sport_legs'|'transitions'|'other';
export type StructuredEvidence={
 key:string;kind:StructuredKind;title:string;source:string;
 /** Canonical owner-supplied authorized reference or bounded presentational detail.
  * Consumers must use the appropriate privacy-safe reader for a real map/series.
  */
 count:number;
};
export type DetailProjection={
 sport:string;
 overview:MetricEvidence[];
 details:MetricEvidence[];
 /** Every supplied eligible metric stays represented even if the user chose to hide it. */
 hiddenMetricKeys:string[];
 sections:StructuredEvidence[];
 /** New/extended source-backed stats appear in Details rather than silently dropping. */
 additionalMetricKeys:string[];
};
const keyValid=(s:string)=>/^[a-z0-9][a-z0-9._:-]*$/i.test(s)&&s.length<=120;
function nonempty(s:string){return typeof s==='string'&&s.trim().length>0;}
function verifiedFact(metric:MetricEvidence){
 return keyValid(metric.key)&&nonempty(metric.label)&&nonempty(metric.value)&&nonempty(metric.source)&&
 ['device','provider','manual','derived','estimated'].includes(metric.provenance);
}
function verifiedSection(section:StructuredEvidence){
 return keyValid(section.key)&&nonempty(section.title)&&nonempty(section.source)&&
 Number.isSafeInteger(section.count)&&section.count>0;
}
/** No missing-to-zero coercion, no invented summaries, and no suppression of
 * unfamiliar metric keys that are genuinely supplied by the owning reader.
 */
export function projectCompletedActivityDetail(input:{
 sport:string;metrics:readonly MetricEvidence[];sections?:readonly StructuredEvidence[];
 overviewLayout?:MetricLayout;detailsLayout?:MetricLayout;
}):DetailProjection{
 const sport=v1SportBaseline(input.sport);
 if(!sport)throw new Error('Completed Activity sport has no approved display policy.');
 if(input.metrics.length>1000||(input.sections?.length??0)>300)throw new Error('Completed Activity evidence exceeds bounded display limit.');
 const eligible=new Map<string,MetricEvidence>();
 for(const metric of input.metrics){
  if(!verifiedFact(metric))continue;
  // Canonical ingestion must resolve conflicting records. Fail closed rather than
  // silently choosing a winner based on ordering or source priority.
  const existing=eligible.get(metric.key);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(metric))throw new Error('Conflicting canonical metric keys.');
  eligible.set(metric.key,metric);
 }
 const supplied=[...eligible.values()];
 const overviewKeys=new Set<string>(sport.overview);
 const baseline=v1AllDetailsMetrics(input.sport);
 const firstOrder=new Map(baseline.map((label,index)=>[label,index]));
 const ordered=[...supplied].sort((a,b)=>
  (firstOrder.get(a.label)??Number.MAX_SAFE_INTEGER)-(firstOrder.get(b.label)??Number.MAX_SAFE_INTEGER));
 const overviewLayout=input.overviewLayout??{order:[],pinned:[],hidden:[]};
 // Overview defaults to the V1 summary, but a user may promote ANY genuine
 // source-backed metric from Details by pinning it. Merely rearranging the
 // customization inventory must not flood Overview with all Details fields.
 const promoted=new Set(overviewLayout.pinned);
 const summary=ordered.filter(x=>overviewKeys.has(x.label)||promoted.has(x.key));
 const overview=presentMetrics(summary,overviewLayout);
 const detailsLayout=input.detailsLayout??{order:[],pinned:[],hidden:[]};
 const details=presentMetrics(ordered,detailsLayout);
 const hiddenMetricKeys=ordered.filter(x=>!details.some(y=>y.key===x.key)).map(x=>x.key);
 const sections:StructuredEvidence[]=[];
 const sectionKeys=new Set<string>();
 for(const item of input.sections??[]){
  if(!verifiedSection(item))continue;
  if(sectionKeys.has(item.key))throw new Error('Duplicate structured section identity.');
  sectionKeys.add(item.key);sections.push(item);
 }
 return {
  sport:input.sport,overview,details,hiddenMetricKeys,sections,
  additionalMetricKeys:ordered.filter(x=>!firstOrder.has(x.label)).map(x=>x.key),
 };
}
