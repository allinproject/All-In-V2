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
