/**
 * ALL-246 / ALL-254: fail-closed presentation adapter for a future canonical
 * authenticated Event owner reader. This is NOT a reader, a certificate issuer,
 * or an authorization replacement. Callers must supply a server-certified,
 * complete owner snapshot; untrusted client records must not be passed as one.
 */
import {certifyEventPlanDetailIdentity,type EventPlanDetailIdentity} from './eventPlanDetailSections.ts';

export type EventPlanOwnerRow = EventPlanDetailIdentity & {
  priority:'A'|'B'|'C'|null;
  cancelled:boolean;
};
export type EventPlanOwnerSnapshot = {
  ownerId:string;
  authSessionGeneration:number;
  complete:boolean;
  nextCursor:string|null;
  snapshotVersion:string;
  events:readonly EventPlanOwnerRow[];
};
export type EventPlanOwnerProjection =
  | {status:'unavailable';reason:string;events:null}
  | {status:'ready';ownerId:string;authSessionGeneration:number;snapshotVersion:string;events:EventPlanOwnerRow[]};

export function projectEventPlanOwnerSnapshot(input:{
  expectedOwnerId:string;
  authenticatedOwnerId:string|null;
  sessionGeneration:number;
  accessGateReady:boolean;
  snapshot:EventPlanOwnerSnapshot|null;
  today:string;
}):EventPlanOwnerProjection {
  const unavailable=(reason:string):EventPlanOwnerProjection=>({status:'unavailable',reason,events:null});
  const s=input.snapshot;
  if(!input.accessGateReady||!input.expectedOwnerId?.trim()||
    input.authenticatedOwnerId!==input.expectedOwnerId||
    !Number.isSafeInteger(input.sessionGeneration)||input.sessionGeneration<0||
    !s||s.ownerId!==input.expectedOwnerId||
    s.authSessionGeneration!==input.sessionGeneration||
    s.complete!==true||s.nextCursor!==null||!s.snapshotVersion?.trim()||
    !Array.isArray(s.events))
    return unavailable('uncertified_event_owner_snapshot');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.today)||
    Number.isNaN(Date.parse(input.today+'T12:00:00Z'))||
    new Date(input.today+'T12:00:00Z').toISOString().slice(0,10)!==input.today)
    return unavailable('invalid_athlete_local_date');
  const ids=new Set<string>();
  const projected:EventPlanOwnerRow[]=[];
  for(const event of s.events){
    if(!event||!certifyEventPlanDetailIdentity(event,{
      ownerId:input.expectedOwnerId,eventId:event.eventId,
      editionId:event.editionId,eventVersion:event.eventVersion,
    })||ids.has(event.eventId)||event.cancelled!==false||
      (event.priority!==null&&!['A','B','C'].includes(event.priority)))
      return unavailable('invalid_or_duplicate_event_identity');
    ids.add(event.eventId);
    if(event.eventDate>=input.today)projected.push({...event});
  }
  // Stable date then identity ordering, retaining ALL A-priority events.
  projected.sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||
    a.eventId.localeCompare(b.eventId));
  return {status:'ready',ownerId:s.ownerId,authSessionGeneration:s.authSessionGeneration,
    snapshotVersion:s.snapshotVersion,events:projected};
}
