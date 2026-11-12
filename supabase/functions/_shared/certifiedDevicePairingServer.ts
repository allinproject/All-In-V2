/** ALL-243 STAGED, server-only device pairing coordinator.
 * Native Apple Watch/HealthKit does NOT emit a generic signed webhook.
 * Only a trusted provider/equipment adapter may issue an INTERNAL HMAC
 * certificate AFTER independently verifying a challenge and device owner.
 * Client-provided "verified" or "certified" fields are NEVER proof.
 */
export type PairingSession={ownerId:string;sessionId:string;expiresAtMs:number};
export type ServerVerifiedDeviceProof={
 challengeId:string;ownerId:string;sessionId:string;
 provider:'apple_watch'|'apple_healthkit'|'supported_equipment';
 deviceRef:string;
 attestationKind:'native_owner_verified'|'provider_account_verified'|'equipment_paired';
 evidenceHash:string;issuedAtMs:number;signatureHex:string;
};
export type PairingTransaction={
 issueChallenge(input:{challengeId:string;ownerId:string;sessionId:string;
  provider:string;deviceRef:string;nowMs:number;expiresAtMs:number}):Promise<boolean>;
 registerProof(input:{challengeId:string;deviceId:string;auditId:string;
  ownerId:string;sessionId:string;provider:string;deviceRef:string;
  attestationKind:string;evidenceHash:string}):Promise<'paired'>;
 revokeDevice(input:{deviceId:string;auditId:string;
  ownerId:string;sessionId:string}):Promise<'revoked'|'already_revoked'>;
};
export type PairingBackend={
 resolveUser(token:string):Promise<PairingSession|null>;
 withOwnerTransaction<T>(ownerId:string,work:(tx:PairingTransaction)=>Promise<T>):Promise<T>;
};
const encoder=new TextEncoder();
const uuid=(s:unknown):s is string=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const deviceRef=(s:unknown):s is string=>typeof s==='string'&&
 s.length>=1&&s.length<=250&&s.trim()===s;
const providers=new Set(['apple_watch','apple_healthkit','supported_equipment']);
const evidenceKinds=new Set(['native_owner_verified','provider_account_verified','equipment_paired']);
const body=(p:ServerVerifiedDeviceProof)=>JSON.stringify([
 p.challengeId,p.ownerId,p.sessionId,p.provider,p.deviceRef,
 p.attestationKind,p.evidenceHash,p.issuedAtMs,
]);
async function hmacKey(secret:string,op:'sign'|'verify'){
 if(secret.length<32)throw Error('Trusted device proof verifier unavailable');
 return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',
  hash:'SHA-256'},false,[op]);
}
/** ONLY the private, separately approved source-evidence verifier uses this;
 * never import it in a public mobile client or a public signing endpoint. */
export async function signTrustedDeviceProof(
 proof:Omit<ServerVerifiedDeviceProof,'signatureHex'>,secret:string,
):Promise<ServerVerifiedDeviceProof>{
 const packet={...proof,signatureHex:''};
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',
  await hmacKey(secret,'sign'),encoder.encode(body(packet))));
 return {...packet,signatureHex:Array.from(sig,x=>x.toString(16).padStart(2,'0')).join('')};
}
export async function verifyTrustedDeviceProof(
 proof:ServerVerifiedDeviceProof,secret:string,nowMs:number,
):Promise<boolean>{
 if(!proof||!uuid(proof.challengeId)||!uuid(proof.ownerId)||
  !uuid(proof.sessionId)||!providers.has(proof.provider)||
  !deviceRef(proof.deviceRef)||!evidenceKinds.has(proof.attestationKind)||
  !/^[0-9a-f]{64}$/.test(proof.evidenceHash)||
  !/^[0-9a-f]{64}$/.test(proof.signatureHex)||
  !Number.isSafeInteger(proof.issuedAtMs)||
  proof.issuedAtMs>nowMs||nowMs-proof.issuedAtMs>300000||
  (proof.provider==='supported_equipment')!==(proof.attestationKind==='equipment_paired'))
  return false;
 const bytes=Uint8Array.from(proof.signatureHex.match(/../g)!,x=>parseInt(x,16));
 return crypto.subtle.verify('HMAC',await hmacKey(secret,'verify'),
  bytes,encoder.encode(body(proof)));
}
async function sessionFor(token:string,backend:PairingBackend,nowMs:number){
 if(typeof token!=='string'||token.length<16||token.length>8192)
  throw Error('Authenticated athlete bearer required');
 const s=await backend.resolveUser(token);
 if(!s||!uuid(s.ownerId)||!uuid(s.sessionId)||
   !Number.isSafeInteger(s.expiresAtMs)||s.expiresAtMs<=nowMs)
  throw Error('Active verified athlete session required');
 return s;
}
export async function issueDevicePairingChallenge(
 token:string,input:{provider:string;deviceRef:string},
 backend:PairingBackend,nowMs:number,
):Promise<{challengeId:string;expiresAtMs:number}>{
 if(!providers.has(input.provider)||!deviceRef(input.deviceRef))
  throw Error('Invalid pairing request');
 const s=await sessionFor(token,backend,nowMs);
 const challengeId=crypto.randomUUID();
 const expiresAtMs=nowMs+5*60*1000;
 const ok=await backend.withOwnerTransaction(s.ownerId,tx=>tx.issueChallenge({
  challengeId,ownerId:s.ownerId,sessionId:s.sessionId,
  provider:input.provider,deviceRef:input.deviceRef,nowMs,expiresAtMs,
 }));
 if(!ok)throw Error('Server pairing challenge unavailable');
 return {challengeId,expiresAtMs};
}
export async function completeVerifiedDevicePairing(
 token:string,proof:ServerVerifiedDeviceProof,backend:PairingBackend,
 internalProofSecret:string,nowMs:number,
):Promise<{status:'paired';deviceId:string}>{
 // An authenticated phone can REQUEST pairing but cannot certify it.
 // A separate trusted verifier must produce the HMAC after checking the
 // provider/native device challenge; no client flag can bypass this.
 if(!await verifyTrustedDeviceProof(proof,internalProofSecret,nowMs))
  throw Error('Trusted device ownership evidence required');
 const s=await sessionFor(token,backend,nowMs);
 if(s.ownerId!==proof.ownerId||s.sessionId!==proof.sessionId)
  throw Error('Pairing owner or active session changed');
 const deviceId=crypto.randomUUID(),auditId=crypto.randomUUID();
 const status=await backend.withOwnerTransaction(s.ownerId,tx=>tx.registerProof({
  challengeId:proof.challengeId,ownerId:s.ownerId,sessionId:s.sessionId,
  deviceId,auditId,provider:proof.provider,deviceRef:proof.deviceRef,
  attestationKind:proof.attestationKind,evidenceHash:proof.evidenceHash,
 }));
 if(status!=='paired')throw Error('Pairing transaction failed');
 return {status,deviceId};
}
export async function revokeOwnedDevice(
 token:string,deviceId:string,backend:PairingBackend,nowMs:number,
):Promise<{status:'revoked'|'already_revoked'}>{
 if(!uuid(deviceId))throw Error('Invalid device identity');
 const s=await sessionFor(token,backend,nowMs);
 const status=await backend.withOwnerTransaction(s.ownerId,tx=>tx.revokeDevice({
  deviceId,ownerId:s.ownerId,sessionId:s.sessionId,auditId:crypto.randomUUID(),
 }));
 if(!['revoked','already_revoked'].includes(status))
  throw Error('Device revoke transaction failed');
 return {status};
}
