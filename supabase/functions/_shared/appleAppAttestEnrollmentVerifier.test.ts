// ALL-243 certificate inspection negative cases. No synthetic root can pass:
 // an Apple-signed chain is mandatory and no receipt trust writer exists.
import {inspectAppleAppAttestation,appAttestChallengeData,APPLE_ROOT_SHA256,inspectAppAttestCredentialPayload}
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

Deno.test('App Attest COSE credential and iOS 27 launch metadata are independently validated',()=>{
 const x=new Uint8Array(32).fill(9),y=new Uint8Array(32).fill(7);
 const point=Uint8Array.from([4,...x,...y]);
 const base=new Uint8Array(87);
 base[32]=0x40;
 const cose=new Map<number,unknown>([[1,2],[3,-7],[-1,1],[-2,x],[-3,y]]);
 const raw=(...parts:Uint8Array[])=>Uint8Array.from(parts.flatMap(p=>[...p]));
 const old=raw(base,encode(cose));
 assert.deepEqual(inspectAppAttestCredentialPayload(old,point),
  {validationCategory:null,bundleVersion:null});
 const modern=raw(base,encode(cose),encode(new Map<string,unknown>([
  ['apple_validation_category_01',new Uint8Array([3,0,0,0])],
  ['apple_bundle_version_01','1.0.0'],
 ])));
 assert.deepEqual(inspectAppAttestCredentialPayload(modern,point),
  {validationCategory:3,bundleVersion:'1.0.0'});
 const altered=Uint8Array.from(point);altered[18]^=1;
 assert.throws(()=>inspectAppAttestCredentialPayload(modern,altered),/COSE/);
 for(const category of [0,1,6,7,8,9,10]){
  const invalid=raw(base,encode(cose),encode(new Map<string,unknown>([
   ['apple_validation_category_01',new Uint8Array([category,0,0,0])],
   ['apple_bundle_version_01','1.0.0'],
  ])));
  assert.throws(()=>inspectAppAttestCredentialPayload(invalid,point),/category/);
 }
 assert.throws(()=>inspectAppAttestCredentialPayload(raw(modern,encode(1)),point),
  /CBOR/);
});
