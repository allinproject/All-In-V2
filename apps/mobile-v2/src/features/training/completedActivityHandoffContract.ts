/** ALL-246 -> ALL-243: proposed typed boundary for one canonical finish-to-activity handoff.
 * No database writer, outbox, network call or source merge is implemented here.
 * One Training session instance retains stable identity across retries.
 * Backend constraints, transactional outbox and server-side source dedupe remain required.
 */
export type CompletionHandoff={
 eventId:string;
 ownerId:string;
 sessionInstanceId:string;
 sourceKind:'phone'|'watch'|'supported_equipment'|'manual'|'import_handoff';
 sourceRecordId:string;
 sport:string;
 sportSubtype:string|null;
 athleteLocalDate:string;
 timezone:string;
 finishedAt:string;
 /** Exact accepted prescription at start, if this was planned. */
 planRevisionSessionId:string|null;
 /** Training-owned immutable finish event, not a canonical activity. */
 finishEventId:string;
};
export type CompletionReceipt={
 eventId:string;ownerId:string;sessionInstanceId:string;
 /** Not ready is not an activity and must not appear as completed in a history read. */
 status:'pending'|'ready'|'needs_review';
 completedActivityId:string|null;
 sourceRecordId:string;
};
const nonblank=(s:unknown,max=180):s is string=>
 typeof s==='string'&&s.length>0&&s.length<=max&&s.trim().length===s.length;
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'));
const timestamp=(s:string)=>!Number.isNaN(Date.parse(s))&&/T/.test(s)&&/(Z|[+-]\d{2}:\d{2})$/.test(s);
function assertHandoff(h:CompletionHandoff){
 if(!nonblank(h.ownerId)||!nonblank(h.eventId)||!nonblank(h.sessionInstanceId)||
 !nonblank(h.sourceRecordId)||!nonblank(h.finishEventId)||!nonblank(h.sport)||
 !nonblank(h.timezone,80)||!date(h.athleteLocalDate)||!timestamp(h.finishedAt)||
 (h.sportSubtype!==null&&!nonblank(h.sportSubtype))||
 (h.planRevisionSessionId!==null&&!nonblank(h.planRevisionSessionId)))
  throw new Error('Invalid canonical completion handoff.');
 if(!['phone','watch','supported_equipment','manual','import_handoff'].includes(h.sourceKind))
  throw new Error('Unsupported completion source kind.');
}
/** A replay of the same immutable outbox event is safe to attempt ONLY when
 * all fields are identical. Server owns the persistent uniqueness constraint.
 */
export function compareCompletionHandoffReplay(original:CompletionHandoff,retry:CompletionHandoff):'exact_retry'{
 assertHandoff(original);assertHandoff(retry);
 if(original.eventId!==retry.eventId||original.sessionInstanceId!==retry.sessionInstanceId||
 original.ownerId!==retry.ownerId)throw new Error('Completion handoff identity mismatch.');
 const fields:(keyof CompletionHandoff)[]=[
  'sourceKind','sourceRecordId','sport','sportSubtype','athleteLocalDate','timezone',
  'finishedAt','planRevisionSessionId','finishEventId',
 ];
 if(fields.some(field=>original[field]!==retry[field]))
  throw new Error('Completion handoff retry payload changed; do not overwrite a terminal finish.');
 return 'exact_retry';
}
/** Validates a response from the authoritative ALL-243 consumer, never
 * constructs or infers an activity ID. Account and source binding are mandatory.
 */
export function acceptCompletionReceipt(h:CompletionHandoff,receipt:CompletionReceipt):CompletionReceipt{
 assertHandoff(h);
 if(receipt.ownerId!==h.ownerId||receipt.sessionInstanceId!==h.sessionInstanceId||
 receipt.eventId!==h.eventId||receipt.sourceRecordId!==h.sourceRecordId)
  throw new Error('Completion receipt does not match original owner/session/source identity.');
 if(receipt.status==='ready'){
  if(!nonblank(receipt.completedActivityId))throw new Error('Ready receipt requires canonical completed activity ID.');
 }else if(receipt.completedActivityId!==null){
  throw new Error('Pending or review-required handoff cannot claim a completed activity.');
 }
 return receipt;
}
/** Only confirmed canonical IDs navigate to the Completed Activity screen.
 * Pending and review states are visible, but never fabricate a workout record.
 */
export function completionNavigationTarget(receipt:CompletionReceipt):string|null{
 return receipt.status==='ready'&&nonblank(receipt.completedActivityId)?
 receipt.completedActivityId:null;
}
