/**
 * ALL-251 source-only INTERNAL composition. Not imported by worker.mjs.
 * No HTTP route or public operation is enabled.
 *
 * Supabase Auth verifies identity and the canonical session/deletion-state
 * RPC confirms active session. Only then may the existing attested-leased
 * writer touch a PRIVATE R2 binding. The lease provider cannot be swapped
 * for an unsigned service-role RPC, and the storage adapter cannot be
 * invoked by the caller directly through this returned interface.
 */
import {verifyAll251OwnerSession,requireOwnedPrivatePath} from './identity-review.mjs';
import {createAll251SessionAuthority} from './session-authority-review.mjs';
import {createPrivilegedStorageWriter} from '../../../supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs';
import {createAll251R2StorageFacade} from '../../../supabase/functions/_shared/all251R2StorageReviewAdapter.mjs';

const BUCKET='v2-private-workout-objects';
export function createAll251InternalWriterReview({
 env,fetchImpl=fetch,binding,attestedLeaseAuthority,
}){
 if(typeof attestedLeaseAuthority?.begin!=='function'||
    typeof attestedLeaseAuthority?.settle!=='function')
  throw Error('ATTESTED_LEASE_REQUIRED');
 const sessionIsActive=createAll251SessionAuthority({env,fetchImpl});
 const storage=createAll251R2StorageFacade({
  binding,logicalBucketId:BUCKET,
 });
 const writer=createPrivilegedStorageWriter({
  supabase:{
   // Canonical writer uses injected attested authority. Explicitly
   // fail any attempted direct unsigned RPC fallback.
   rpc:async()=>{throw Error('UNSIGNED_LEASE_FORBIDDEN');},
   storage,
  },
  leaseAuthority:attestedLeaseAuthority,
  requireAttestedLease:true,
 });
 return Object.freeze({
  async writeFromVerifiedRequest({request,path,bytes,operation='create',
   contentType='application/octet-stream'}){
   // Never accept verifiedOwnerId as a request field.
   const {verifiedOwnerId}=await verifyAll251OwnerSession({
    request,env,sessionIsActive,fetchImpl,
   });
   requireOwnedPrivatePath(verifiedOwnerId,path);
   return writer.write({
    verifiedOwnerId,bucketId:BUCKET,path,
    bytes,operation,contentType,
   });
  },
 });
}
