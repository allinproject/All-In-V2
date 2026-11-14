/**
 * ALL-222 review-only operation boundary for private resumable uploads.
 * This does NOT expose an HTTP endpoint, write a session table or revoke a
 * Supabase TUS session. A trusted runtime must supply actual owner advisory
 * serialization covering provider byte commits, never a preflight-only lock.
 */
import {authorizePrivateResumableOperation} from './trainingPrivateResumableAuthorization.mjs';

const denied=()=>{throw Error('private_resumable_operation_unverified');};
export function createPrivateResumableOperationBoundary({
  withCanonicalOwnerFence,readLockedState,performWithinFence,clock,
  providerIngressRestricted=false,exclusiveCommitFenceProven=false,
}={}){
  if(typeof withCanonicalOwnerFence!=='function'||
     typeof readLockedState!=='function'||
     typeof performWithinFence!=='function'||typeof clock!=='function')denied();
  if(providerIngressRestricted!==true||exclusiveCommitFenceProven!==true)denied();
  return Object.freeze({
    async execute(request){
      if(!request||typeof request!=='object'||typeof request.verifiedOwnerId!=='string')
        denied();
      // No caller-provided lease/session/ownerState can authorize work.
      // The sole owner lock must be held THROUGH the provider operation.
      return withCanonicalOwnerFence(request.verifiedOwnerId,async()=>{
        const state=await readLockedState(request);
        if(!state||state.verifiedIdentity?.ownerId!==request.verifiedOwnerId)denied();
        const decision=authorizePrivateResumableOperation({
          action:request.action,
          verifiedIdentity:state.verifiedIdentity,
          session:state.session,lease:state.lease,ownerState:state.ownerState,
          requestedBucket:request.bucketId,requestedPath:request.path,
          requestedSessionId:request.sessionId,expectedOffset:request.offset,
          chunkBytes:request.chunkBytes,nowMs:clock(),
          providerIngressRestricted,exclusiveCommitFenceProven,
        });
        // The provider callback is trusted and never returns a bearer URL.
        // Successful preflight is NOT proof of a byte commit or revocation.
        const proof=await performWithinFence({request,decision});
        if(request.action==='PATCH'){
          if(!proof||proof.verified!==true||
             proof.offset!==decision.expectedOffset+request.chunkBytes)
            denied();
          return Object.freeze({status:'chunk_verified',offset:proof.offset});
        }
        if(request.action==='CANCEL'){
          // A database cancellation without a provider-session invalidation
          // and absent bytes cannot be reported as completed cancellation.
          if(proof?.providerSessionInvalidated!==true||
             proof?.providerByteAbsenceVerified!==true||
             proof?.canonicalLeaseCancelled!==true)denied();
          return Object.freeze({status:'cancel_verified'});
        }
        if(request.action==='FINALIZE'){
          if(proof?.providerExactSha256Verified!==true||
             proof?.canonicalSignedLeaseSettled!==true)denied();
          return Object.freeze({status:'finalized_verified'});
        }
        if(request.action==='HEAD'){
          if(proof?.verified!==true||proof.offset!==decision.expectedOffset)denied();
          return Object.freeze({status:'offset_verified',offset:proof.offset});
        }
        if(request.action==='CREATE'){
          if(proof?.providerSessionPrivate!==true||
             proof?.canonicalAttestedLeaseBound!==true)denied();
          return Object.freeze({status:'session_created'});
        }
        denied();
      });
    },
  });
}
