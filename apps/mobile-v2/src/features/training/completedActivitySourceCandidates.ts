/** ALL-243: complete, owner-certified source candidate boundary.
 * The server must attest to this snapshot from an authenticated, transactional
 * owner-scoped query. Client-provided flags are NOT proof of database coverage.
 */
import {reconcileActivitySource,sourceIdentityKey,
 type ActivitySourceIdentity,type LinkedCanonicalSource,type SourceReconciliationDecision,
} from './completedActivitySourceReconciliation.ts';
export type CanonicalSourceCandidateSnapshot={
 ownerId:string;sourceIdentityKey:string;
 /** Complete source-key and plausible overlapping-event search, NOT all history. */
 scope:'source_identity_and_relevant_overlap';
 /** A non-null cursor means more candidate pages remain. */
 nextCursor:string|null;
 complete:boolean;
 /** Stable committed view version; backend must enforce this, not just label it. */
 readVersion:number;
 candidates:readonly LinkedCanonicalSource[];
};
export type CertifiedReconciliationDecision=
 SourceReconciliationDecision|
 {decision:'needs_review';activityId:null;reason:
   'incomplete_candidate_coverage'|'unsupported_provider_namespace'};
/** Fail closed for unfinished pagination, stale owner, missing snapshot metadata or
 * a source identity other than the one the snapshot was produced for.
 */
export function reconcileCertifiedActivitySource(
 incoming:ActivitySourceIdentity,snapshot:CanonicalSourceCandidateSnapshot,
):CertifiedReconciliationDecision{
 const id=sourceIdentityKey(incoming);
 if(snapshot.ownerId!==incoming.ownerId||snapshot.sourceIdentityKey!==id)
  throw new Error('Source candidate owner or identity mismatch.');
 if(snapshot.scope!=='source_identity_and_relevant_overlap'||
  !Number.isSafeInteger(snapshot.readVersion)||snapshot.readVersion<1)
  throw new Error('Unverified source candidate coverage contract.');
 // A foreign-owner row is a privacy violation even if this incoming provider
 // is unsupported or pagination is unfinished. Never short-circuit past it.
 if(!Array.isArray(snapshot.candidates)||
    snapshot.candidates.some(c=>!c||!c.identity||
      c.identity.ownerId!==incoming.ownerId))
  throw new Error('Cross-account candidate included in owner-scoped source read.');
 // Must match the currently modeled SQL provider + record-kind vocabulary.
 // This is NOT certification that any provider actually supplied genuine
 // identity; an unregistered Garmin/COROS/alias feed remains review-only.
 const providers=new Set(['apple_healthkit','apple_watch',
   'supported_equipment','manual','import']);
 const sourceKinds=new Set(['workout_record','sensor_summary','manual_record',
   'device_session','imported_historical_record']);
 if(!providers.has(incoming.provider)||!sourceKinds.has(incoming.sourceKind))
  return {decision:'needs_review',activityId:null,reason:'unsupported_provider_namespace'};
 if(!snapshot.complete||snapshot.nextCursor!==null)
  return {decision:'needs_review',activityId:null,reason:'incomplete_candidate_coverage'};
 return reconcileActivitySource(incoming,snapshot.candidates);
}
