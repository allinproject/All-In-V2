/** ALL-243 STAGED: authoritative iPhone App Attest enrollment orchestration.
 * NOT an Edge route. The receipt checker is a mandatory, independent
 * server-only Apple PKCS#7/CMS validator; no implementation is wired yet.
 * A client cannot set 'receiptValid', enroll its key or pass an arbitrary
 * trust result. No database writes can occur without BOTH review gates.
 */
import {createHash} from 'node:crypto';
import {appAttestChallengeData,inspectAppleAppAttestation}
 from './appleAppAttestEnrollmentVerifier.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validApp=/^[A-Z0-9]{10}\.[a-zA-Z0-9.-]{3,180}$/;
export type AppleEnrollmentSession={ownerId:string;sessionId:string;expiresAtMs:number};
export type EnrollmentChallenge={
 challengeId:string;ownerId:string;sessionId:string;appId:string;
 environment:'production'|'sandbox';expiresAtMs:number;consumedAtMs:number|null;
};
export type AppAttestEnrollmentTransaction={
 issueChallenge(input:EnrollmentChallenge):Promise<void>;
 getActiveChallenge(input:{challengeId:string;ownerId:string;sessionId:string}):
  Promise<EnrollmentChallenge|null>;
 insertVerifiedKey(input:{
  challengeId:string;ownerId:string;sessionId:string;
  appId:string;environment:'production'|'sandbox';keyId:string;
  publicKeySpkiBase64url:string;receiptHash:string;leafHash:string;
 }):Promise<'enrolled'>;
};
export type AppAttestEnrollmentBackend={
 resolveUser(token:string):Promise<AppleEnrollmentSession|null>;
 withOwnerTransaction<T>(ownerId:string,fn:(tx:AppAttestEnrollmentTransaction)=>
  Promise<T>):Promise<T>;
};
/** A separately vetted validator MUST cryptographically check Apple's signed
 * receipt chain, app ID, attested public key and a fresh creation timestamp.
 * This interface is deliberately NOT implemented from user-supplied input. */
export type VerifiedAppleReceiptService={
 verifyAppleSignedReceipt(input:{
  receiptB64url:string;appId:string;keyId:string;
  publicKeySpkiBase64url:string;nowMs:number;
 }):Promise<{trusted:true;receiptSha256:string}>;
};
function requireSession(s:AppleEnrollmentSession|null,nowMs:number){
 if(!s||!uuid.test(s.ownerId)||!uuid.test(s.sessionId)||
  !Number.isSafeInteger(s.expiresAtMs)||s.expiresAtMs<=nowMs)
  throw Error('Active Auth-verified Apple enrollment session required');
 return s;
}
export async function beginAppAttestEnrollment(
 bearer:string,backend:AppAttestEnrollmentBackend,appId:string,
 environment:'sandbox'|'production',nowMs:number,
):Promise<{challengeId:string;challengeDataBase64url:string;expiresAtMs:number}>{
 if(!validApp.test(appId)||!['sandbox','production'].includes(environment)||
  !Number.isSafeInteger(nowMs))throw Error('Invalid Apple enrollment configuration');
 const identity=requireSession(await backend.resolveUser(bearer),nowMs);
 const challengeId=crypto.randomUUID(),expiresAtMs=nowMs+5*60*1000;
 await backend.withOwnerTransaction(identity.ownerId,tx=>tx.issueChallenge({
  challengeId,ownerId:identity.ownerId,sessionId:identity.sessionId,
  appId,environment,expiresAtMs,consumedAtMs:null,
 }));
 return {
  challengeId,challengeDataBase64url:appAttestChallengeData(
   identity.ownerId,identity.sessionId,challengeId,appId).toString('base64url'),
  expiresAtMs,
 };
}
export async function completeAppAttestEnrollment(
 bearer:string,input:{
  challengeId:string;keyId:string;attestationObjectB64url:string;
 },
 backend:AppAttestEnrollmentBackend,
 receiptService:VerifiedAppleReceiptService|undefined,nowMs:number,
):Promise<'enrolled'>{
 // No receipt verifier means enrollment CANNOT be authorized, even when
 // the certificate chain and signed nonce pass.
 if(!receiptService)throw Error('Apple signed-receipt verifier unavailable');
 if(!uuid.test(input.challengeId)||!Number.isSafeInteger(nowMs))
  throw Error('Invalid Apple enrollment request');
 const identity=requireSession(await backend.resolveUser(bearer),nowMs);
 return backend.withOwnerTransaction(identity.ownerId,async tx=>{
  const challenge=await tx.getActiveChallenge({
   challengeId:input.challengeId,ownerId:identity.ownerId,
   sessionId:identity.sessionId,
  });
  if(!challenge||challenge.ownerId!==identity.ownerId||
    challenge.sessionId!==identity.sessionId||
    challenge.consumedAtMs!==null||challenge.expiresAtMs<=nowMs)
   throw Error('App Attest challenge missing, expired or consumed');
  const review=inspectAppleAppAttestation({
   attestationB64url:input.attestationObjectB64url,keyId:input.keyId,
   appId:challenge.appId,
   challengeData:appAttestChallengeData(
    identity.ownerId,identity.sessionId,input.challengeId,challenge.appId),
   environment:challenge.environment,nowMs,
  });
  const receipt=await receiptService.verifyAppleSignedReceipt({
   receiptB64url:review.receiptB64url,appId:review.appId,
   keyId:review.keyId,publicKeySpkiBase64url:review.publicKeySpkiBase64url,
   nowMs,
  });
  if(!receipt||receipt.trusted!==true||
    !/^[a-f0-9]{64}$/.test(receipt.receiptSha256))
   throw Error('Apple receipt not independently authenticated');
  const actualReceiptHash=createHash('sha256')
   .update(Buffer.from(review.receiptB64url,'base64url')).digest('hex');
  if(actualReceiptHash!==receipt.receiptSha256)
   throw Error('Apple receipt proof does not match signed evidence');
  return tx.insertVerifiedKey({
   challengeId:input.challengeId,ownerId:identity.ownerId,
   sessionId:identity.sessionId,appId:challenge.appId,
   environment:challenge.environment,keyId:review.keyId,
   publicKeySpkiBase64url:review.publicKeySpkiBase64url,
   receiptHash:receipt.receiptSha256,leafHash:review.leafFingerprint,
  });
 });
}
