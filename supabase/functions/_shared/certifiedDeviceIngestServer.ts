/** ALL-243: server-only authenticated ingestion coordinator (staged, no public endpoint).
 * Apple HealthKit/Watch do not provide a generic signed webhook. A native
 * ingestion gateway MUST authenticate the athlete/device through its own
 * supported flow before signing an INTERNAL envelope; never call this a
 * provider signature or accept it directly from a mobile client.
 */
import {routeVerifiedDeviceCallback,type VerifiedDeviceCallback,
 type CanonicalDeviceWriter,type DeviceCallbackResult}
 from '../../../apps/mobile-v2/src/features/training/certifiedDeviceCallbackWriter.ts';

export type DeviceIngestEnvelope={
 payload:VerifiedDeviceCallback;
 issuedAtMs:number;
 nonce:string;
 signatureHex:string;
};
export type AuthenticatedDeviceIngestBackend={
 /** Atomically consume a nonce with a unique constraint and TTL retention,
  * enforce authenticated account, registered source and session ownership. */
 consumeNonceAndAuthorize(input:{nonce:string;ownerId:string;sourceId:string;
  provider:string;issuedAtMs:number}):Promise<boolean>;
 /** Implementation MUST use a single database transaction and hold owner,
  * source and canonical activity locks across candidate read and append. */
 writer:CanonicalDeviceWriter;
};
const encode=new TextEncoder();
function hex(bytes:Uint8Array):string{
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function stableEnvelopeBody(e:DeviceIngestEnvelope):string{
 // Fixed field ordering; sign exact payload JSON bytes, not a client claim.
 return JSON.stringify([e.issuedAtMs,e.nonce,e.payload]);
}
export async function signInternalDeviceEnvelope(
 payload:VerifiedDeviceCallback,issuedAtMs:number,nonce:string,secret:string,
):Promise<DeviceIngestEnvelope>{
 if(secret.length<32||!Number.isSafeInteger(issuedAtMs)||!/^[-_a-zA-Z0-9]{24,128}$/.test(nonce))
  throw new Error('Invalid internal ingest signing configuration.');
 const envelope={payload,issuedAtMs,nonce,signatureHex:''};
 const key=await crypto.subtle.importKey('raw',encode.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,
  encode.encode(stableEnvelopeBody(envelope))));
 return {...envelope,signatureHex:hex(signature)};
}
export async function ingestAuthenticatedDeviceEnvelope(
 envelope:DeviceIngestEnvelope,backend:AuthenticatedDeviceIngestBackend,
 secret:string,nowMs:number,
):Promise<DeviceCallbackResult>{
 if(secret.length<32||!Number.isSafeInteger(nowMs)||
  !Number.isSafeInteger(envelope.issuedAtMs)||
  Math.abs(nowMs-envelope.issuedAtMs)>300000||
  !/^[-_a-zA-Z0-9]{24,128}$/.test(envelope.nonce)||
  !/^[0-9a-f]{64}$/.test(envelope.signatureHex))
  throw new Error('Expired or malformed internal device ingest envelope.');
 const key=await crypto.subtle.importKey('raw',encode.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new Uint8Array(envelope.signatureHex.match(/../g)!.map(x=>parseInt(x,16)));
 const valid=await crypto.subtle.verify('HMAC',key,bytes,
  encode.encode(stableEnvelopeBody(envelope)));
 if(!valid)throw new Error('Internal device ingest signature invalid.');
 const {identity,source}=envelope.payload;
 if(identity.ownerId!==source.ownerId||identity.provider!==source.provider)
  throw new Error('Device callback identity mismatch.');
 const allowed=await backend.consumeNonceAndAuthorize({
  nonce:envelope.nonce,ownerId:identity.ownerId,sourceId:source.sourceId,
  provider:identity.provider,issuedAtMs:envelope.issuedAtMs,
 });
 if(!allowed)throw new Error('Device ingest replay or authorization denied.');
 return routeVerifiedDeviceCallback(envelope.payload,backend.writer);
}


/**
 * ALL-243 staging bridge for the real canonical writer. No HTTP endpoint or
 * elevated database grant is created. The host must implement the transaction
 * with one trusted PostgreSQL session and the existing private scalar writer.
 *
 * A bearer token is NOT an identity merely because it decodes to a JWT claim.
 * resolveUser MUST contact trusted Auth. The transaction-side gate MUST check
 * auth.sessions (including revocation/expiry), device registration, exact
 * source record and athlete ownership against the authoritative database.
 * Locking, nonce consumption, candidate read and scalar writes MUST commit
 * or roll back together. The database adapter is still a release gate.
 */
export type VerifiedAthleteSession={
 ownerId:string;sessionId:string;expiresAtMs:number;
};
export type CanonicalIngestTransaction={
 /** Verified against the current DB state *inside* the same transaction. */
 authorizeActiveOwnerSource(input:{
  ownerId:string;sessionId:string;activityId:string;sourceId:string;
  provider:string;sourceKind:string;sourceRecordId:string;
  certifiedSessionInstanceId:string|null;nowMs:number;
 }):Promise<boolean>;
 /** Canonical nonce ledger insertion, unique and transactional (not a cache). */
 consumeNonce(input:{nonce:string;ownerId:string;sessionId:string;
  activityId:string;sourceId:string;issuedAtMs:number;
  callbackHash:string}):Promise<boolean>;
 /** This must invoke the existing source-reconciliation + scalar append writer
  * inside the SAME database transaction, never a client-created ledger. */
 writer:CanonicalDeviceWriter;
};
export type AuthenticatedCanonicalIngestBackend={
 /** Verify bearer with the Auth service; never trust a client owner claim. */
 resolveUser(bearerToken:string):Promise<VerifiedAthleteSession|null>;
 /** Reject if the callback changes the verified session or switches account;
  * serialize/roll back all operations under the canonical owner lock. */
 runOwnerTransaction<T>(ownerId:string,work:(tx:CanonicalIngestTransaction)=>
  Promise<T>):Promise<T>;
};
const identityToken=(s:string)=>typeof s==='string'&&s.length>=16&&s.length<=8192;
export async function ingestVerifiedDeviceEnvelopeTransactional(
 envelope:DeviceIngestEnvelope,
 backend:AuthenticatedCanonicalIngestBackend,
 bearerToken:string,secret:string,nowMs:number,
):Promise<DeviceCallbackResult>{
 // Validate the internal signed packet BEFORE Auth or database side effects.
 if(secret.length<32||!Number.isSafeInteger(nowMs)||
  !Number.isSafeInteger(envelope.issuedAtMs)||
  Math.abs(nowMs-envelope.issuedAtMs)>300000||
  !/^[-_a-zA-Z0-9]{24,128}$/.test(envelope.nonce)||
  !/^[0-9a-f]{64}$/.test(envelope.signatureHex))
  throw new Error('Expired or malformed internal device ingest envelope.');
 const key=await crypto.subtle.importKey('raw',encode.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['verify']);
 const signatureBytes=new Uint8Array(envelope.signatureHex.match(/../g)!.map(x=>parseInt(x,16)));
 if(!await crypto.subtle.verify('HMAC',key,signatureBytes,
  encode.encode(stableEnvelopeBody(envelope))))
  throw new Error('Internal device ingest signature invalid.');
 if(!identityToken(bearerToken))throw new Error('Authenticated athlete bearer required');
 const session=await backend.resolveUser(bearerToken);
 if(!session||!session.ownerId||!session.sessionId||
  !Number.isSafeInteger(session.expiresAtMs)||session.expiresAtMs<=nowMs)
  throw new Error('Active verified athlete session required');
 const {identity,source}=envelope.payload;
 if(envelope.payload.verifiedByProviderAdapter!==true||
  source.certifiedByServer!==true||
  identity.ownerId!==session.ownerId||source.ownerId!==session.ownerId||
  identity.provider!==source.provider||!source.activityId||!source.sourceId)
  throw new Error('Authenticated owner and device source mismatch');
 return backend.runOwnerTransaction(session.ownerId,async tx=>{
  const authInput={
   ownerId:session.ownerId,sessionId:session.sessionId,
   activityId:source.activityId,sourceId:source.sourceId,
   provider:identity.provider,sourceKind:identity.sourceKind,
   sourceRecordId:identity.sourceRecordId,
   certifiedSessionInstanceId:identity.certifiedSessionInstanceId,nowMs,
  };
  // DB must recheck the active Auth session and certified source registration.
  if(!await tx.authorizeActiveOwnerSource(authInput))
   throw new Error('Current session or registered device source denied');
  if(!await tx.consumeNonce({
   nonce:envelope.nonce,ownerId:session.ownerId,sessionId:session.sessionId,
   activityId:source.activityId,sourceId:source.sourceId,
   issuedAtMs:envelope.issuedAtMs,callbackHash:envelope.signatureHex,
  }))throw new Error('Device ingest replay or nonce denied');
  const outcome=await routeVerifiedDeviceCallback(envelope.payload,tx.writer);
  // Also require live session/source binding at the end, before commit. This
  // protects a long-running candidate read/append against account switching.
  if(!await tx.authorizeActiveOwnerSource(authInput))
   throw new Error('Current session or registered device source changed');
  return outcome;
 });
}
