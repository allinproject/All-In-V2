/** ALL-243 Apple Watch + verified companion-app pairing proof (STAGED).
 *
 * Security model:
 *  - WatchCrypto P-256 key signs the server's owner/session-bound challenge.
 *  - A previously APPLE-ATTESTED *iPhone* App Attest key asserts the exact
 *    watch key and response with a monotonically increasing counter.
 *  - The server retrieves the certified phone key and challenge from its
 *    private database, never from client claims.
 *  - Server verifies two independent signatures before issuing the PRIVATE
 *    HMAC certificate consumed by canonical device pairing.
 *
 * App Attest proves a registered instance of the iOS companion app, NOT an
 * Apple Watch hardware serial/identity. WatchConnectivity adds a paired
 * transport signal, not a cryptographic Apple Watch hardware attestation.
 * No unregistered phone App Attest key can pass; Apple attestation enrollment
 * and physical WatchConnectivity acceptance are separate required gates.
 */
import {signTrustedDeviceProof,type PairingBackend,type ServerVerifiedDeviceProof}
 from './certifiedDevicePairingServer.ts';

const enc=new TextEncoder();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hex64=/^[a-f0-9]{64}$/;
const base64url=/^[A-Za-z0-9_-]+$/;
const toHex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const byteBuffer=(data:Uint8Array):ArrayBuffer=>new Uint8Array(data).buffer;
const digest=async(data:Uint8Array)=>new Uint8Array(await crypto.subtle.digest('SHA-256',byteBuffer(data)));
function decode(s:string,limit:number){
 if(typeof s!=='string'||s.length<4||s.length>limit||!base64url.test(s))
  throw Error('Malformed cryptographic proof');
 const padded=s.replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(padded.padEnd(Math.ceil(padded.length/4)*4,'='));
 return Uint8Array.from(raw,x=>x.charCodeAt(0));
}
function join(...parts:Uint8Array[]){
 const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
 let offset=0;for(const part of parts){b.set(part,offset);offset+=part.length;}
 return b;
}
function p256Signature(sig:Uint8Array){
 if(sig.length===64)return sig;
 // Apple App Attest's CryptoKit / Security ECDSA signatures are DER-encoded.
 // WebCrypto uses IEEE P1363 r||s. Reject nonminimal/ambiguous DER encodings.
 let i=0;
 function len(){
  if(i>=sig.length)throw Error('Invalid DER signature');
  const first=sig[i++];
  if(first<128)return first;
  const n=first&127;
  if(n===0||n>2||i+n>sig.length)throw Error('Invalid DER signature');
  let value=0;for(let j=0;j<n;j++)value=(value<<8)|sig[i++];
  if(value<128)throw Error('Nonminimal DER signature');
  return value;
 }
 if(sig[i++]!==0x30)throw Error('Invalid DER signature');
 const seqLen=len();
 if(i+seqLen!==sig.length)throw Error('Invalid DER length');
 const components:Uint8Array[]=[];
 for(let c=0;c<2;c++){
  if(sig[i++]!==0x02)throw Error('Invalid DER integer');
  const n=len();if(n<1||n>33||i+n>sig.length)throw Error('Invalid DER integer length');
  let v=sig.slice(i,i+n);i+=n;
  if(v[0]&0x80)throw Error('Negative DER signature integer');
  if(v.length>1&&v[0]===0){
   if(!(v[1]&0x80))throw Error('Nonminimal DER integer');
   v=v.slice(1);
  }
  if(v.length>32)throw Error('Oversized DER signature integer');
  const fixed=new Uint8Array(32);fixed.set(v,32-v.length);
  components.push(fixed);
 }
 if(i!==sig.length)throw Error('Invalid DER trailer');
 return join(...components);
}
/** Extract exactly the two CBOR byte strings from Apple generateAssertion
 * (authenticatorData, signature). Reject extra or nested fields. */
function parseAppAssertion(value:string){
 const bytes=decode(value,8192);let offset=0;
 const read=()=>{if(offset>=bytes.length)throw Error('Truncated Apple assertion');
  return bytes[offset++];};
 function length(additional:number){
  if(additional<24)return additional;
  if(additional===24)return read();
  if(additional===25)return (read()<<8)|read();
  throw Error('Unsupported Apple assertion CBOR length');
 }
 const start=read();
 if((start>>5)!==5)throw Error('Invalid Apple assertion map');
 const count=length(start&31);
 if(count!==2)throw Error('Unexpected Apple assertion fields');
 const fields=new Map<string,Uint8Array>();
 for(let j=0;j<count;j++){
  const k=read();if((k>>5)!==3)throw Error('Invalid Apple assertion key');
  const kl=length(k&31);
  if(kl<3||kl>50||offset+kl>bytes.length)throw Error('Invalid Apple assertion key');
  const key=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(offset,offset+kl));
  offset+=kl;
  const v=read();if((v>>5)!==2)throw Error('Invalid Apple assertion field');
  const vl=length(v&31);
  if(vl<1||vl>2048||offset+vl>bytes.length||fields.has(key))
   throw Error('Invalid Apple assertion value');
  fields.set(key,bytes.slice(offset,offset+vl));offset+=vl;
 }
 if(offset!==bytes.length||fields.size!==2||
  !fields.has('authenticatorData')||!fields.has('signature'))
  throw Error('Invalid Apple assertion payload');
 return {authData:fields.get('authenticatorData')!,
  signature:fields.get('signature')!};
}
export type AppleWatchNativePairingRequest={
 challengeId:string;watchPublicKeySpkiB64url:string;
 watchSignatureB64url:string;
 phoneAppAttestKeyId:string;phoneAssertionCborB64url:string;
};
export type VerifiedApplePhoneKey={
 keyId:string;ownerId:string;appId:string;publicKeySpkiB64url:string;
 signCount:number;appleAttestationVerifiedAtMs:number;revokedAtMs:null|number;
};
export type AppleWatchPairingChallenge={
 challengeId:string;ownerId:string;sessionId:string;provider:'apple_watch';
 deviceRef:string;expiresAtMs:number;consumedAtMs:null|number;
};
export type AppleWatchEvidenceStore={
 getChallenge(input:{challengeId:string;ownerId:string;sessionId:string}):
  Promise<AppleWatchPairingChallenge|null>;
 getAppleAttestedPhoneKey(input:{keyId:string;ownerId:string}):
  Promise<VerifiedApplePhoneKey|null>;
 /** Atomic CAS: only one request can consume a newly valid assertion count;
  * must use same transaction as issued proof audit/confirmation. */
 advancePhoneCounter(input:{keyId:string;ownerId:string;
  previousCount:number;newCount:number}):Promise<boolean>;
};
export type AppleWatchVerifiedBackend=PairingBackend&{
 withEvidenceTransaction<T>(ownerId:string,work:(store:AppleWatchEvidenceStore)=>
  Promise<T>):Promise<T>;
};
export function watchDeviceReference(spkiHash:string){
 if(!hex64.test(spkiHash))throw Error('Invalid watch key fingerprint');
 return 'watch-key:'+spkiHash;
}
export function watchChallengePayload(input:{
 challengeId:string;ownerId:string;sessionId:string;deviceRef:string;
}){
 return enc.encode(JSON.stringify(['ALL-IN-365-WATCH-PAIR-V1',
  input.challengeId,input.ownerId,input.sessionId,input.deviceRef]));
}
export function phoneAppAssertionPayload(input:{
 challengeId:string;ownerId:string;sessionId:string;deviceRef:string;
 watchSignatureHash:string;
}){
 return enc.encode(JSON.stringify(['ALL-IN-365-IOS-PAIR-V1',
  input.challengeId,input.ownerId,input.sessionId,input.deviceRef,
  input.watchSignatureHash]));
}
export async function verifyAppleWatchControlAndIssueProof(
 bearer:string,request:AppleWatchNativePairingRequest,
 backend:AppleWatchVerifiedBackend,secret:string,
 expectedAppId:string,nowMs:number,
):Promise<ServerVerifiedDeviceProof>{
 if(!request||!uuid.test(request.challengeId)||
  typeof request.phoneAppAttestKeyId!=='string'||
  request.phoneAppAttestKeyId.length<10||request.phoneAppAttestKeyId.length>300||
  !/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{3,180}$/.test(expectedAppId)||
  !Number.isSafeInteger(nowMs))throw Error('Invalid Apple pairing request');
 const identity=await backend.resolveUser(bearer);
 if(!identity||!uuid.test(identity.ownerId)||!uuid.test(identity.sessionId)||
   identity.expiresAtMs<=nowMs)throw Error('Active owner Auth session required');
 const watchSpki=decode(request.watchPublicKeySpkiB64url,512);
 const watchSignature=p256Signature(decode(request.watchSignatureB64url,256));
 const fingerprint=toHex(await digest(watchSpki));
 const deviceRef=watchDeviceReference(fingerprint);
 const watchKey=await crypto.subtle.importKey('spki',watchSpki,{
  name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const watchBody=watchChallengePayload({
  challengeId:request.challengeId,ownerId:identity.ownerId,
  sessionId:identity.sessionId,deviceRef,
 });
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},
  watchKey,byteBuffer(watchSignature),byteBuffer(watchBody)))
  throw Error('Watch challenge signature invalid');
 const {authData,signature:phoneSignature}=parseAppAssertion(
  request.phoneAssertionCborB64url);
 if(authData.length!==37)throw Error('Invalid Apple App Attest authenticator data');
 const appIdHash=await digest(enc.encode(expectedAppId));
 if(toHex(authData.slice(0,32))!==toHex(appIdHash)||
  !(authData[32]&0x01))throw Error('Wrong Apple app identity or flags');
 const count=new DataView(authData.buffer,authData.byteOffset+33,4).getUint32(0,false);
 const watchSignatureHash=toHex(await digest(watchSignature));
 const clientHash=await digest(phoneAppAssertionPayload({
  challengeId:request.challengeId,ownerId:identity.ownerId,
  sessionId:identity.sessionId,deviceRef,watchSignatureHash,
 }));
 const evidenceHash=toHex(await digest(join(watchBody,watchSignature,
  clientHash,authData,phoneSignature)));
 const issued=await backend.withEvidenceTransaction(identity.ownerId,async store=>{
  const [challenge,key]=await Promise.all([
   store.getChallenge({challengeId:request.challengeId,ownerId:identity.ownerId,
    sessionId:identity.sessionId}),
   store.getAppleAttestedPhoneKey({keyId:request.phoneAppAttestKeyId,
    ownerId:identity.ownerId}),
  ]);
  if(!challenge||challenge.ownerId!==identity.ownerId||
    challenge.sessionId!==identity.sessionId||challenge.provider!=='apple_watch'||
    challenge.deviceRef!==deviceRef||challenge.consumedAtMs!==null||
    challenge.expiresAtMs<=nowMs)
   throw Error('Apple Watch server pairing challenge unavailable');
  if(!key||key.ownerId!==identity.ownerId||
    key.keyId!==request.phoneAppAttestKeyId||key.appId!==expectedAppId||
    key.revokedAtMs!==null||key.appleAttestationVerifiedAtMs>nowMs||
    key.signCount>=count)
   throw Error('Apple-attested companion not registered or replayed');
  const phoneKey=await crypto.subtle.importKey('spki',
   decode(key.publicKeySpkiB64url,512),{
    name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const validPhone=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},
   phoneKey,byteBuffer(p256Signature(phoneSignature)),byteBuffer(join(authData,clientHash)));
  if(!validPhone)throw Error('Apple app assertion signature invalid');
  if(!await store.advancePhoneCounter({
   ownerId:identity.ownerId,keyId:key.keyId,
   previousCount:key.signCount,newCount:count,
  }))throw Error('Apple app assertion counter stale');
  return true;
 });
 if(!issued)throw Error('Native device evidence rejected');
 // Private signer called ONLY after verifying both keys and Apple's
 // independently attested iPhone public-key record.
 return signTrustedDeviceProof({
  challengeId:request.challengeId,ownerId:identity.ownerId,
  sessionId:identity.sessionId,provider:'apple_watch',deviceRef,
  attestationKind:'native_owner_verified',evidenceHash,issuedAtMs:nowMs,
 },secret);
}
