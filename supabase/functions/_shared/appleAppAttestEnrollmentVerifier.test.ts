// ALL-243 certificate inspection negative cases. No synthetic root can pass:
 // an Apple-signed chain is mandatory and no receipt trust writer exists.
import {inspectAppleAppAttestation,appAttestChallengeData,APPLE_ROOT_SHA256}
 from './appleAppAttestEnrollmentVerifier.ts';
import {encode} from 'npm:cbor-x@1.6.0';
import assert from 'node:assert/strict';

Deno.test('official Apple App Attestation root is fingerprint-pinned',()=>{
 assert.equal(APPLE_ROOT_SHA256,
 '1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932');
});
const base={
 keyId:Buffer.alloc(32,1).toString('base64url'),
 appId:'ABCDE12345.com.allin365.app',
 challengeData:appAttestChallengeData(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'ABCDE12345.com.allin365.app'),
 environment:'sandbox' as const,nowMs:Date.now(),
};
function attempt(body:unknown){
 const buffer=encode(body);
 return inspectAppleAppAttestation({...base,
  attestationB64url:Buffer.from(buffer).toString('base64url')});
}
Deno.test('fake, missing, expired or client-controlled chain fails closed',()=>{
 for(const payload of [
  {},
  {fmt:'apple-appattest'},
  {fmt:'apple-appattest',attStmt:{x5c:[],receipt:new Uint8Array([1])},
   authData:new Uint8Array(164)},
  {fmt:'apple-appattest',attStmt:{
   x5c:[new Uint8Array(100),new Uint8Array(100)],
   receipt:new Uint8Array([1])},authData:new Uint8Array(164)},
  {fmt:'packed',attStmt:{x5c:[new Uint8Array(10),new Uint8Array(10)]},
   authData:new Uint8Array(164)},
 ]){
  assert.throws(()=>attempt(payload));
 }
});
Deno.test('client cannot supply its own trust root',()=>{
 const forged={fmt:'apple-appattest',attStmt:{
  x5c:[new Uint8Array([48,0]),new Uint8Array([48,0])],
  receipt:new Uint8Array([1])},authData:new Uint8Array(164),
  rootCertificatePem:'-----BEGIN CERTIFICATE----- fake root'};
 assert.throws(()=>attempt(forged));
});
Deno.test('enrollment challenge bytes are tied to exact verified identity',()=>{
 const raw=appAttestChallengeData(
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 'ABCDE12345.com.allin365.app');
 const foreign=appAttestChallengeData(
 '44444444-4444-4444-8444-444444444444',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 'ABCDE12345.com.allin365.app');
 assert.notDeepEqual(raw,foreign);
 assert.throws(()=>appAttestChallengeData('spoof','bad','bad','app'));
});
