/**
 * ALL-222 / ALL-251 — protected resumable request authorization policy.
 * REVIEW/STAGING-ONLY, NOT AN HTTP HANDLER OR PROVIDER PROXY.
 *
 * Does not grant a lease, hold a database lock, revoke a TUS URL or commit
 * object bytes. Only a trusted backend can supply these server-read facts.
 * The eventual handler MUST serialize provider writes with cancellation and
 * deletion, and prove raw provider Storage/TUS ingress cannot bypass it.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET='v2-private-workout-objects';
const ACTIONS=new Set(['CREATE','HEAD','PATCH','FINALIZE','CANCEL']);
const MAX_TOTAL=8*1024*1024;
const MAX_CHUNK=6*1024*1024;
const validInteger=n=>Number.isSafeInteger(n)&&n>=0;
const deny=()=>{throw Error('private_resumable_not_authorized');};

export function authorizePrivateResumableOperation({
  action, verifiedIdentity, session, lease, ownerState,
  requestedBucket, requestedPath, requestedSessionId,
  expectedOffset, chunkBytes, nowMs,
  providerIngressRestricted=false, exclusiveCommitFenceProven=false,
}){
  // Explicitly fail closed until the direct Supabase provider bypass is
  // prevented AND a real deletion/cancel/byte-commit serialization is proven.
  if(providerIngressRestricted!==true||exclusiveCommitFenceProven!==true)
    deny();
  if(!ACTIONS.has(action)||!validInteger(nowMs)||nowMs===0)
    deny();
  if(!verifiedIdentity||verifiedIdentity.currentSession!==true||
     verifiedIdentity.revoked!==false||!UUID.test(verifiedIdentity.ownerId??'')||
     !UUID.test(verifiedIdentity.authSessionId??''))deny();
  const owner=verifiedIdentity.ownerId;
  if(ownerState?.ownerId!==owner||ownerState?.deletionLocked!==false||
     ownerState?.disabled!==false)deny();
  if(!session||!UUID.test(session.id??'')||
     session.id!==requestedSessionId||
     session.ownerId!==owner||
     session.authSessionId!==verifiedIdentity.authSessionId||
     session.bucketId!==BUCKET||session.bucketId!==requestedBucket||
     session.path!==requestedPath||session.state!=='active'||
     !validInteger(session.expiresAtMs)||session.expiresAtMs<=nowMs||
     !validInteger(session.totalBytes)||session.totalBytes<1||
     session.totalBytes>MAX_TOTAL||
     !validInteger(session.offset)||session.offset>session.totalBytes||
     session.providerUrlExposed!==false)deny();
  if(!lease||!UUID.test(lease.id??'')||
     lease.id!==session.leaseId||lease.ownerId!==owner||
     lease.bucketId!==BUCKET||lease.path!==session.path||
     lease.operation!=='create'||lease.signedAttested!==true||
     lease.cancelledAt!==null||lease.settledAt!==null||
     !validInteger(lease.expiresAtMs)||lease.expiresAtMs<=nowMs)
    deny();
  if(!session.path.startsWith(owner+'/')||
     session.path.length>1024||
     session.path.split('/').some(s=>!s||s==='.'||s==='..'||/[\\\u0000-\u001f]/.test(s)))
    deny();
  if(action==='PATCH'){
    if(!validInteger(expectedOffset)||expectedOffset!==session.offset||
       !validInteger(chunkBytes)||chunkBytes<1||chunkBytes>MAX_CHUNK||
       expectedOffset+chunkBytes>session.totalBytes)deny();
  } else if(expectedOffset!==undefined||chunkBytes!==undefined)deny();
  if(action==='FINALIZE'&&session.offset!==session.totalBytes)deny();
  return Object.freeze({
    action, verifiedOwnerId:owner, internalSessionId:session.id,
    leaseId:lease.id, expectedOffset:session.offset,
    totalBytes:session.totalBytes,
  });
}
