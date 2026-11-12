/** ALL-243 Apple Watch proof + actual registrar Postgres integration in CI.
 * Synthetic key material and an admin-seeded "previously verified" iPhone
 * key are TEST FIXTURES, not evidence of genuine Apple CA attestation.
 * No hosted database, physical Watch or Apple production key is contacted.
 */
import postgres from 'npm:postgres@3.4.7';
import assert from 'node:assert/strict';
import {createDevicePairingPostgresBackend}
 from '../supabase/functions/_shared/certifiedDevicePairingPostgres.ts';
import {createAppleWatchOwnershipPostgresBackend}
 from '../supabase/functions/_shared/appleWatchOwnershipPostgres.ts';
import {watchDeviceReference,watchChallengePayload,phoneAppAssertionPayload,
 verifyAppleWatchControlAndIssueProof}
 from '../supabase/functions/_shared/appleWatchOwnershipVerifier.ts';
import {issueDevicePairingChallenge,completeVerifiedDevicePairing,
 revokeOwnedDevice} from '../supabase/functions/_shared/certifiedDevicePairingServer.ts';
import type {TransactionalSql}
 from '../supabase/functions/_shared/certifiedDevicePostgresAdapter.ts';
const url=Deno.env.get('ALLIN_PAIRING_TEST_URL')??'';
const adminUrl=Deno.env.get('ALLIN_PG_ADMIN_URL')??'';
if(!url.includes('@127.0.0.1:5432/')||
 !adminUrl.includes('@127.0.0.1:5432/'))throw Error('Disposable database only');
const registrar=postgres(url,{max:1,prepare:false,connect_timeout:5});
const admin=postgres(adminUrl,{max:1,prepare:false,connect_timeout:5});
const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bearer='verified-owner-session-test-token';
const secret='local-fixture-internal-pairing-HMAC-32bytes';
const appId='ABCDE12345.com.allin365.app';
const keyId='synthetic-apple-attested-key-runtime';
const enc=new TextEncoder();
const now=Date.now();
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const digest=async(b:Uint8Array)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b).buffer));
const b64url=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
function cborLen(major:number,n:number){return n<24?[major<<5|n]:
 n<256?[major<<5|24,n]:[major<<5|25,n>>8,n&255];}
function appleCbor(authData:Uint8Array,signature:Uint8Array){
 const bytes=[0xa2];
 for(const [name,v] of [['authenticatorData',authData],['signature',signature]] as const){
  const label=enc.encode(name);bytes.push(...cborLen(3,label.length),...label,
   ...cborLen(2,v.length),...v);
 }
 return b64url(new Uint8Array(bytes));
}
const base=createDevicePairingPostgresBackend({
 db:registrar as unknown as TransactionalSql,
 auth:{getUser:async token=>token===bearer?{id:owner}:null},
 readVerifiedTokenClaims:token=>token===bearer?{
  sessionId:session,expiresAtMs:now+300000}:null,
 nowMs:()=>Date.now(),
});
const backend=createAppleWatchOwnershipPostgresBackend(
 base,registrar as unknown as TransactionalSql);
Deno.test('real PostgreSQL registrar verifies two native P-256 signatures and monotone App Attest counter',async()=>{
 try{
  const watch=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},
   true,['sign','verify']);
  const phone=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},
   true,['sign','verify']);
  const watchSpki=new Uint8Array(await crypto.subtle.exportKey('spki',watch.publicKey));
  const phoneSpki=new Uint8Array(await crypto.subtle.exportKey('spki',phone.publicKey));
  const deviceRef=watchDeviceReference(hex(await digest(watchSpki)));
  // Simulates ONLY the already approved external Apple certificate-chain
  // attestation verifier. This runtime does not validate Apple CA chains.
  await admin.unsafe(`
INSERT INTO allin_private.v2_apple_attested_companion_keys_candidate(
 key_id,owner_id,apple_app_id,public_key_spki_base64url,
 apple_attestation_verified_at)
 VALUES ($1,$2::uuid,$3,$4,now()-interval '1 minute')`,[
   keyId,owner,appId,b64url(phoneSpki)]);
  const challenge=await issueDevicePairingChallenge(bearer,{
   provider:'apple_watch',deviceRef},base,Date.now());
  async function nativeRequest(counter:number){
   const watchText=watchChallengePayload({
    challengeId:challenge.challengeId,ownerId:owner,sessionId:session,deviceRef});
   const signedWatch=new Uint8Array(await crypto.subtle.sign({
    name:'ECDSA',hash:'SHA-256'},watch.privateKey,
    new Uint8Array(watchText).buffer));
   const signedHash=hex(await digest(signedWatch));
   const context=phoneAppAssertionPayload({
    challengeId:challenge.challengeId,ownerId:owner,sessionId:session,
    deviceRef,watchSignatureHash:signedHash});
   const hashedContext=await digest(context);
   const authData=new Uint8Array(37);
   authData.set(await digest(enc.encode(appId)));
   authData[32]=0x01;new DataView(authData.buffer).setUint32(33,counter,false);
   const phoneInput=new Uint8Array([...authData,...hashedContext]);
   const signedPhone=new Uint8Array(await crypto.subtle.sign({
    name:'ECDSA',hash:'SHA-256'},phone.privateKey,(await digest(phoneInput)).buffer));
   return {challengeId:challenge.challengeId,
    watchPublicKeySpkiB64url:b64url(watchSpki),
    watchSignatureB64url:b64url(signedWatch),phoneAppAttestKeyId:keyId,
    phoneAssertionCborB64url:appleCbor(authData,signedPhone)};
  }
  const request=await nativeRequest(1);
  const proof=await verifyAppleWatchControlAndIssueProof(bearer,request,backend,
   secret,appId,Date.now());
  assert.equal(proof.deviceRef,deviceRef);
  assert.equal((await admin.unsafe(`
SELECT assertion_sign_count FROM allin_private.v2_apple_attested_companion_keys_candidate
 WHERE key_id=$1`,[keyId]))[0].assertion_sign_count,'1');
  await assert.rejects(verifyAppleWatchControlAndIssueProof(bearer,
   request,backend,secret,appId,Date.now()),/replay|registered/);
  const paired=await completeVerifiedDevicePairing(bearer,proof,base,
   secret,Date.now());
  assert.equal(paired.status,'paired');
  assert.deepEqual(await revokeOwnedDevice(bearer,paired.deviceId,base,Date.now()),
   {status:'revoked'});
  assert.equal((await admin.unsafe(`
SELECT count(*)::int AS n FROM allin_private.v2_device_registrations_candidate
WHERE id=$1::uuid AND revoked_at IS NOT NULL`,[paired.deviceId]))[0].n,1);
 }finally{
  await registrar.end({timeout:3});await admin.end({timeout:3});
 }
});
