/** ALL-243 native iPhone / watchOS pairing handoff.
 * The server remains the ONLY identity and proof authority. The phone may
 * request a challenge and relay a signed WatchConnectivity+App Attest proof,
 * but can never mint or certify its own registration.
 *
 * This is a UI-independent boundary: call from an authenticated founder
 * pairing screen only after server-side App Attest enrolment has succeeded.
 * Never persist bearer tokens, private keys or HMACs in React Native.
 */
export type WatchPairingNative={
 fetchWatchKey():Promise<{
  deviceRef:string;watchPublicKeySpkiB64url:string;
 }>;
 signChallenge(
  challengeId:string,ownerId:string,sessionId:string,
  deviceRef:string,watchPublicKeySpkiB64url:string,appAttestKeyId:string,
 ):Promise<{
  challengeId:string;watchPublicKeySpkiB64url:string;
  watchSignatureB64url:string;phoneAppAttestKeyId:string;
  phoneAssertionCborB64url:string;
 }>;
};
export type WatchPairingServer={
 request(payload:Readonly<Record<string,unknown>>):Promise<unknown>;
};
type Session={ownerId:string;sessionId:string;attestedPhoneKeyId:string};
const validUUID=(s:unknown):s is string=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const deviceRefPattern=/^watch-key:[0-9a-f]{64}$/;

export async function pairVerifiedAppleWatch(
 native:WatchPairingNative,server:WatchPairingServer,session:Session,
):Promise<{deviceId:string;status:'paired'}>{
 if(!validUUID(session.ownerId)||!validUUID(session.sessionId)||
  !session.attestedPhoneKeyId||session.attestedPhoneKeyId.length>300)
  throw Error('Verified athlete session and enrolled App Attest key required');
 const watch=await native.fetchWatchKey();
 if(!deviceRefPattern.test(watch.deviceRef)||
  typeof watch.watchPublicKeySpkiB64url!=='string'||
  !/^[A-Za-z0-9_-]{100,250}$/.test(watch.watchPublicKeySpkiB64url))
  throw Error('Watch public key identity unavailable');
 const response=await server.request({
  action:'challenge',provider:'apple_watch',deviceRef:watch.deviceRef,
 }) as {challengeId?:string;expiresAtMs?:number}|null;
 if(!response||!validUUID(response.challengeId)||
  typeof response.expiresAtMs!=='number'||
  response.expiresAtMs<=Date.now())
  throw Error('Valid owner-bound server pairing challenge required');
 const signature=await native.signChallenge(
  response.challengeId,session.ownerId,session.sessionId,
  watch.deviceRef,watch.watchPublicKeySpkiB64url,session.attestedPhoneKeyId,
 );
 if(signature.challengeId!==response.challengeId||
  signature.watchPublicKeySpkiB64url!==watch.watchPublicKeySpkiB64url||
  signature.phoneAppAttestKeyId!==session.attestedPhoneKeyId||
  !/^[A-Za-z0-9_-]{80,200}$/.test(signature.watchSignatureB64url)||
  !/^[A-Za-z0-9_-]{40,8192}$/.test(signature.phoneAssertionCborB64url))
  throw Error('Native watch or iPhone proof missing or mismatched');
 const verified=await server.request({
  action:'appleWatchProof',request:signature,
 }) as {proof?:Record<string,unknown>}|null;
 if(!verified?.proof||
  verified.proof.ownerId!==session.ownerId||
  verified.proof.sessionId!==session.sessionId||
  verified.proof.deviceRef!==watch.deviceRef||
  verified.proof.challengeId!==response.challengeId||
  verified.proof.provider!=='apple_watch')
  throw Error('Trusted server-side watch verification required');
 // Final registration is the existing one-time, owner-scoped pairing writer.
 const paired=await server.request({
  action:'pair',proof:verified.proof,
 }) as {status?:string;deviceId?:string}|null;
 if(paired?.status!=='paired'||!validUUID(paired.deviceId))
  throw Error('Server rejected watch registration');
 return {status:'paired',deviceId:paired.deviceId!};
}

export async function revokeVerifiedAppleWatch(
 server:WatchPairingServer,deviceId:string,
):Promise<'revoked'|'already_revoked'>{
 if(!validUUID(deviceId))throw Error('Invalid registered device identity');
 const result=await server.request({
  action:'revoke',deviceId,
 }) as {status?:string}|null;
 if(result?.status!=='revoked'&&result?.status!=='already_revoked')
  throw Error('Device revocation failed');
 return result.status;
}
