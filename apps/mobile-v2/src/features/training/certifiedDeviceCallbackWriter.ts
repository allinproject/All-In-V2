/** ALL-243 server integration seam. NOT an HTTP endpoint and NOT a live SQL grant.
 * An authenticated server provider adapter must verify callback signatures,
 * freshness, provider record ownership and source registration BEFORE invoking.
 * The writer must be the existing canonical transactional append writer, not a
 * second ledger. Both candidate search and write require database owner checks.
 */
import {prepareCertifiedDeviceMetric,type CertifiedDeviceSource,
 type DeviceMetricObservation,type CanonicalMetricAppend} from './trustedDeviceMetricBoundary.ts';
import {reconcileCertifiedActivitySource,type CanonicalSourceCandidateSnapshot}
 from './completedActivitySourceCandidates.ts';
import {sourceIdentityKey,type ActivitySourceIdentity}
 from './completedActivitySourceReconciliation.ts';

export type VerifiedDeviceCallback={
 /** Only a trusted server verifier may construct this after checking signatures
  * and mapping provider record identity to the authenticated athlete. */
 verifiedByProviderAdapter:true;
 identity:ActivitySourceIdentity;
 source:CertifiedDeviceSource;
 observations:readonly DeviceMetricObservation[];
};
export type CanonicalDeviceWriter={
 /** Only the trusted database adapter can opt in. An exact registered source
  * is not proof that every scalar measurement was already persisted; the
  * canonical metric writer itself enforces immutable idempotent replay. */
 appendMissingMetricsOnExactSourceReplay?:true;
 /** Snapshot MUST be transactional, owner-scoped and complete for identity + overlap. */
 findCandidates(identity:ActivitySourceIdentity):Promise<CanonicalSourceCandidateSnapshot>;
 /** Atomic owner-checked canonical write. Must enforce source uniqueness, immutable
  * revision and idempotency under concurrency; no direct client access. */
 appendVerifiedMeasurements(args:{
  identity:ActivitySourceIdentity;activityId:string;
  expectedReadVersion:number;metrics:readonly CanonicalMetricAppend[];
 }):Promise<{activityId:string;outcome:'appended'|'already_applied'}>;
};
export type DeviceCallbackResult=
 |{status:'written'|'already_applied';activityId:string}
 |{status:'review_required';reason:string;activityId:string|null};

export async function routeVerifiedDeviceCallback(
 callback:VerifiedDeviceCallback,writer:CanonicalDeviceWriter,
):Promise<DeviceCallbackResult>{
 if(callback.verifiedByProviderAdapter!==true||
  callback.identity.ownerId!==callback.source.ownerId||
  callback.identity.provider!==callback.source.provider||
  callback.identity.payloadFingerprint!==callback.observations[0]?.sourcePayloadHash||
  callback.observations.length===0||callback.observations.length>500)
  throw new Error('Provider callback certification or payload binding failed.');
 // Validate ALL observations before any side effect.
 const metrics=callback.observations.map(x=>prepareCertifiedDeviceMetric(callback.source,x));
 if(metrics.some(m=>m.sourcePayloadHash!==callback.identity.payloadFingerprint))
  throw new Error('Device callback contains mixed payload revisions.');
 const snapshot=await writer.findCandidates(callback.identity);
 if(snapshot.sourceIdentityKey!==sourceIdentityKey(callback.identity))
  throw new Error('Source candidate identity changed.');
 const decision=reconcileCertifiedActivitySource(callback.identity,snapshot);
 if(decision.decision==='exact_replay'&&!writer.appendMissingMetricsOnExactSourceReplay)
  return {status:'already_applied',activityId:decision.activityId};
 if(decision.decision==='needs_review'||decision.decision==='revision_review')
  return {status:'review_required',reason:decision.reason,activityId:decision.activityId};
 if(decision.decision==='new_activity_candidate')
  return {status:'review_required',reason:'canonical_activity_creation_requires_approved_writer',
   activityId:null};
 // Exact replay reaches the writer ONLY when the trusted DB adapter explicitly
 // enables canonical missing-measurement append. No changed source revisions.
 const activityId=decision.activityId;
 if(callback.source.activityId!==activityId)
  throw new Error('Certified activity identity does not match reconciliation.');
 const result=await writer.appendVerifiedMeasurements({
  identity:callback.identity,activityId,expectedReadVersion:snapshot.readVersion,metrics,
 });
 if(result.activityId!==activityId||!['appended','already_applied'].includes(result.outcome))
  throw new Error('Canonical writer returned inconsistent activity identity.');
 return {status:result.outcome==='appended'?'written':'already_applied',activityId};
}
