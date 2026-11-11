/** ALL-243 canonical source reconciliation decision policy, no database writes.
 * Caller must use authoritative owner-verified records. This does not authorize
 * automatic source merges; server still owns uniqueness and atomicity.
 * The known list must contain only the owner's source-identity or potential
 * overlapping-workout candidates, NOT the athlete's entire activity history.
 */
export type ActivitySourceIdentity={
 ownerId:string;
 provider:string;
 sourceKind:string;
 sourceRecordId:string;
 /** Evidence for a particular source record revision, not a new workout. */
 revision:string;
 payloadFingerprint:string;
 /** Server-certified exact Training session link. Never user inferred. */
 certifiedSessionInstanceId:string|null;
};
export type LinkedCanonicalSource={
 identity:ActivitySourceIdentity;
 canonicalActivityId:string;
};
export type SourceReconciliationDecision=
 |{decision:'exact_replay';activityId:string;reason:'same_source_same_payload'}
 |{decision:'revision_review';activityId:string;reason:'source_revision_or_payload_changed'}
 |{decision:'attach_certified_session';activityId:string;reason:'same_certified_session'}
 |{decision:'needs_review';activityId:null;reason:'conflicting_activity_links'|'unverified_cross_provider_overlap'}
 |{decision:'new_activity_candidate';activityId:null;reason:'distinct_source_no_verified_link'};
const text=(s:string,max=512)=>typeof s==='string'&&s.length>0&&s.length<=max&&s.trim()===s;
export function sourceIdentityKey(s:ActivitySourceIdentity):string{
 if(!text(s.ownerId,150)||!text(s.provider,100)||!text(s.sourceKind,100)||
 !text(s.sourceRecordId)||!text(s.revision,120)||!text(s.payloadFingerprint,200)||
 (s.certifiedSessionInstanceId!==null&&!text(s.certifiedSessionInstanceId,150)))
  throw new Error('Invalid activity source identity.');
 // Tuple serialization avoids delimiter/substring collision and maintains exact provider IDs.
 return JSON.stringify([s.ownerId,s.provider,s.sourceKind,s.sourceRecordId]);
}
/** Does not treat mere shared time, distance or HR as verified identity.
 * On a source-revision change, data cannot be silently overwritten.
 * On a certified Training session match, attach only when one stable canonical
 * activity target exists; all conflicts remain review-required.
 */
export function reconcileActivitySource(
 incoming:ActivitySourceIdentity,
 known:readonly LinkedCanonicalSource[],
):SourceReconciliationDecision{
 const id=sourceIdentityKey(incoming);
 if(known.length>2000)throw new Error('Source reconciliation candidate set exceeds limit.');
 const sameSource:LinkedCanonicalSource[]=[],sameSession:LinkedCanonicalSource[]=[];
 for(const linked of known){
  const key=sourceIdentityKey(linked.identity);
  if(!text(linked.canonicalActivityId,150))throw new Error('Invalid canonical activity linkage.');
  if(linked.identity.ownerId!==incoming.ownerId)continue;
  if(key===id)sameSource.push(linked);
  if(incoming.certifiedSessionInstanceId!==null&&
     linked.identity.certifiedSessionInstanceId===incoming.certifiedSessionInstanceId)
   sameSession.push(linked);
 }
 if(sameSource.length){
  const activities=new Set(sameSource.map(s=>s.canonicalActivityId));
  if(activities.size!==1)return {decision:'needs_review',activityId:null,reason:'conflicting_activity_links'};
  const activityId=sameSource[0].canonicalActivityId;
  // Same source can never point to multiple activities, nor a different
  // already certified physical Training session.
  if(sameSource.some(s=>s.identity.certifiedSessionInstanceId!==null&&
    incoming.certifiedSessionInstanceId!==null&&
    s.identity.certifiedSessionInstanceId!==incoming.certifiedSessionInstanceId))
    return {decision:'needs_review',activityId:null,reason:'conflicting_activity_links'};
  if(sameSession.some(s=>s.canonicalActivityId!==activityId))
    return {decision:'needs_review',activityId:null,reason:'conflicting_activity_links'};
  if(sameSource.some(s=>s.identity.revision!==incoming.revision||
   s.identity.payloadFingerprint!==incoming.payloadFingerprint||
   s.identity.certifiedSessionInstanceId!==incoming.certifiedSessionInstanceId))
   return {decision:'revision_review',activityId,reason:'source_revision_or_payload_changed'};
  return {decision:'exact_replay',activityId,reason:'same_source_same_payload'};
 }
 if(incoming.certifiedSessionInstanceId!==null&&sameSession.length){
  const targets=new Set(sameSession.map(s=>s.canonicalActivityId));
  if(targets.size!==1)return {decision:'needs_review',activityId:null,reason:'conflicting_activity_links'};
  return {decision:'attach_certified_session',activityId:sameSession[0].canonicalActivityId,reason:'same_certified_session'};
 }
 if(known.some(x=>x.identity.ownerId===incoming.ownerId)){
  // Other workouts may share time windows, sport, route or similar sensor
  // readings. Those features are insufficient to prove identity.
  return {decision:'needs_review',activityId:null,reason:'unverified_cross_provider_overlap'};
 }
 return {decision:'new_activity_candidate',activityId:null,reason:'distinct_source_no_verified_link'};
}
