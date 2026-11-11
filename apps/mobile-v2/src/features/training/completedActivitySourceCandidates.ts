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
 {decision:'needs_review';activityId:null;reason:'incomplete_candidate_coverage'};
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
 if(!snapshot.complete||snapshot.nextCursor!==null)
  return {decision:'needs_review',activityId:null,reason:'incomplete_candidate_coverage'};
 if(snapshot.candidates.some(c=>c.identity.ownerId!==incoming.ownerId))
  throw new Error('Cross-account candidate included in owner-scoped source read.');
 return reconcileActivitySource(incoming,snapshot.candidates);
}
