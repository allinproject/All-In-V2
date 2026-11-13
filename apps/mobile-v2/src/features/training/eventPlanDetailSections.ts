/**
 * ALL-246/234: presentation-only Event Plan section policy. Never certifies,
 * persists, or fabricates event data. A canonical owner reader must supply the
 * event to the UI that consumes this projection.
 */
export type EventPlanDiscipline =
  'endurance'|'triathlon'|'swimming'|'powerlifting'|'physique'|'other';
export type EventPlanSectionId =
  'overview'|'strategy'|'course'|'fueling'|'logistics'|'execution';
export type EventPlanSection = {id:EventPlanSectionId;title:string};
export type EventPlanDetailIdentity = {
  ownerId:string; eventId:string; eventVersion:number;
  editionId:string; discipline:EventPlanDiscipline;
  name:string; eventDate:string;
};
export function eventPlanSections(discipline:EventPlanDiscipline):EventPlanSection[] {
  if(!['endurance','triathlon','swimming','powerlifting','physique','other'].includes(discipline))
    throw Error('Unknown event discipline cannot be assumed to be a race.');
  const common:EventPlanSection[]=[
    {id:'overview',title:'Event Overview'},
    {id:'strategy',title:'Coach Event Strategy'},
  ];
  if(discipline==='endurance'||discipline==='triathlon')
    common.push({id:'course',title:'Course & Aid Stations'});
  if(discipline==='endurance'||discipline==='triathlon')
    common.push({id:'fueling',title:'Fueling & Hydration'});
  common.push({id:'logistics',title:'Event Logistics & Rules'});
  common.push({id:'execution',title:'Event-Day Execution'});
  return common;
}
export function certifyEventPlanDetailIdentity(
  event:EventPlanDetailIdentity|null,
  context:{ownerId:string;eventId:string;editionId:string;eventVersion:number},
):EventPlanDetailIdentity|null {
  if(!event||!context.ownerId?.trim()||!context.eventId?.trim()||
      !context.editionId?.trim()||event.ownerId!==context.ownerId||
      event.eventId!==context.eventId||event.editionId!==context.editionId||
      event.eventVersion!==context.eventVersion||
      !Number.isSafeInteger(event.eventVersion)||event.eventVersion<1||
      !event.name?.trim()||
      !/^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)||
      !['endurance','triathlon','swimming','powerlifting','physique','other'].includes(event.discipline))
    return null;
  const parsed=new Date(event.eventDate+'T12:00:00Z');
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==event.eventDate)
    return null;
  return {...event};
}

export type EventPlanSectionEvidence = {
  ownerId:string;eventId:string;editionId:string;eventVersion:number;
  sectionId:EventPlanSectionId;text:string;
};
/**
 * Section content must match the currently selected certified event revision.
 * A stale or foreign payload is never shown even if its section ID is valid.
 * This is a UI guard; the backend must independently enforce owner access.
 */
export function certifiedEventPlanSectionText(
  event:EventPlanDetailIdentity,
  evidence:readonly EventPlanSectionEvidence[]|undefined,
):Partial<Record<EventPlanSectionId,string>> {
  const visible=new Set(eventPlanSections(event.discipline).map(x=>x.id));
  const output:Partial<Record<EventPlanSectionId,string>>={};
  if(!Array.isArray(evidence))return output;
  const seen=new Set<EventPlanSectionId>();
  for(const item of evidence) {
    if(!item||!visible.has(item.sectionId)||seen.has(item.sectionId)||
       item.ownerId!==event.ownerId||item.eventId!==event.eventId||
       item.editionId!==event.editionId||item.eventVersion!==event.eventVersion||
       typeof item.text!=='string'||!item.text.trim())continue;
    seen.add(item.sectionId);
    output[item.sectionId]=item.text;
  }
  return output;
}
