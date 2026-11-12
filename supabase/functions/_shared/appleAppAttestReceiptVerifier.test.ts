// ALL-243: receipt parsing can pass with synthetic payload bytes, but ONLY
// Apple-rooted CMS can pass the separate production cryptographic trust gate.
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {inspectAppAttestReceiptPayload,appleAppAttestReceiptService}
 from './appleAppAttestReceiptVerifier.ts';
function tlv(tag:number,value:Uint8Array):Buffer{
 const len=value.length;
 const prefix=len<128?[len]:len<256?[0x81,len]:[0x82,len>>8,len&255];
 return Buffer.concat([Buffer.from([tag,...prefix]),Buffer.from(value)]);
}
const seq=(...v:Uint8Array[])=>tlv(0x30,Buffer.concat(v));
const field=(id:number,value:Uint8Array)=>
 seq(tlv(2,Buffer.from([id])),tlv(2,Buffer.from([1])),tlv(4,value));
const txt=(s:string)=>tlv(0x0c,Buffer.from(s));
const time=(s:string)=>tlv(0x16,Buffer.from(s));
const {publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const spki=publicKey.export({format:'der',type:'spki'});
const jwk=publicKey.export({format:'jwk'}) as {x:string;y:string};
const point=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),
 Buffer.from(jwk.y,'base64url')]);
const clientHash=Buffer.alloc(32,5);
const now=Date.parse('2026-11-12T17:00:00.000Z');
const context={appId:'ABCDE12345.com.allin365.app',
 keyId:createHash('sha256').update(point).digest('base64url'),
 publicKeySpkiBase64url:spki.toString('base64url'),
 clientDataHashBase64url:clientHash.toString('base64url'),
 environment:'sandbox' as const,nowMs:now};
function payload(overrides:Record<number,Uint8Array>={}){
 const base:Record<number,Uint8Array>={
  2:txt(context.appId),3:spki,4:clientHash,6:txt('ATTEST'),
  12:time('2026-11-12T16:59:00.000Z'),
  21:time('2026-11-13T17:00:00.000Z')};
 const fields={...base,...overrides};
 return tlv(0x31,Buffer.concat(Object.keys(fields)
  .map(Number).sort((a,b)=>a-b).map(id=>field(id,fields[id]))));
}
Deno.test('signed payload field bindings accept exact App ID, challenge, P-256 key and original receipt',()=>{
 assert.equal(inspectAppAttestReceiptPayload(payload(),context).receiptType,'ATTEST');
 assert.equal(inspectAppAttestReceiptPayload(payload({
  4:Buffer.from(clientHash.toString('hex'))}),context).receiptType,'ATTEST');
});
Deno.test('signed payload denies wrong app, challenge, key, receipt type and freshness',()=>{
 const bad=[
  payload({2:txt('ABCDE12345.com.attacker.app')}),
  payload({4:Buffer.alloc(32,6)}),
  payload({3:Buffer.alloc(80,9)}),
  payload({6:txt('RECEIPT')}),
  payload({12:time('2026-11-12T16:40:00.000Z')}),
  payload({12:time('2026-11-12T17:05:00.000Z')}),
  payload({21:time('2026-11-12T16:00:00.000Z')}),
 ];
 for(const p of bad)assert.throws(()=>inspectAppAttestReceiptPayload(p,context));
 assert.throws(()=>inspectAppAttestReceiptPayload(payload(),
  {...context,keyId:Buffer.alloc(32,9).toString('base64url')}),/credential ID/);
 assert.throws(()=>inspectAppAttestReceiptPayload(payload(),
  {...context,clientDataHashBase64url:Buffer.alloc(32,7).toString('base64url')}),/hash/);
});
Deno.test('ASN.1 truncation, duplicates and malformed CMS always fail closed',async()=>{
 const p=payload();
 assert.throws(()=>inspectAppAttestReceiptPayload(p.subarray(0,p.length-1),context));
 const duplicate=tlv(0x31,Buffer.concat([field(2,txt(context.appId)),p.subarray(4)]));
 assert.throws(()=>inspectAppAttestReceiptPayload(duplicate,context));
 for(const bytes of [Buffer.alloc(0),Buffer.from('garbage'),p]){
  await assert.rejects(appleAppAttestReceiptService.verifyAppleSignedReceipt({
   ...context,receiptB64url:bytes.toString('base64url')}));
 }
});

Deno.test('cryptographically signed CMS by an untrusted synthetic CA never enrolls',async()=>{
 // Offline fixture created with OpenSSL cms -sign -binary -nodetach.
 // It is correctly signed but is NOT anchored at Apple's pinned root.
 const fake=Buffer.from('MIIDfAYJKoZIhvcNAQcCoIIDbTCCA2kCAQExDTALBglghkgBZQMEAgEwEQYJKoZIhvcNAQcBoAQEAjEAoIIBqjCCAaYwggFNoAMCAQICFDzcZmBwCPmVOsmFtp08gBb+7P8IMAoGCCqGSM49BAMCMCkxJzAlBgNVBAMMHlVudHJ1c3RlZCBTeW50aGV0aWMgQ01TIFNpZ25lcjAeFw0yNjExMTIxNzU4NThaFw0zNjExMDkxNzU4NThaMCkxJzAlBgNVBAMMHlVudHJ1c3RlZCBTeW50aGV0aWMgQ01TIFNpZ25lcjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABFKS7X1OT2e70EzfLHpgx2PnGIpMjhmRGxNFlIC8TyC7m3PWj5ZtjvY+HHzynuyP27ddI/rxEVet9zD+0CvwrB2jUzBRMB0GA1UdDgQWBBQPnAIa8Oh8vH1aPQnJjEkSpZ3xIzAfBgNVHSMEGDAWgBQPnAIa8Oh8vH1aPQnJjEkSpZ3xIzAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIBLWFg3hskXGlj9AwgeBCdc5aif9fOgaozsrtzGvYHXjAiAaVMfi8c6din8DHo9aurCFVQd0unnvU3K+Tn/szs6C3TGCAZIwggGOAgEBMEEwKTEnMCUGA1UEAwweVW50cnVzdGVkIFN5bnRoZXRpYyBDTVMgU2lnbmVyAhQ83GZgcAj5lTrJhbadPIAW/uz/CDALBglghkgBZQMEAgGggeQwGAYJKoZIhvcNAQkDMQsGCSqGSIb3DQEHATAcBgkqhkiG9w0BCQUxDxcNMjYxMTEyMTc1ODU5WjAvBgkqhkiG9w0BCQQxIgQg555BjkhiNWnXXip7Ca6I7Zt3sSakRbn/ncaYmgjvoHkweQYJKoZIhvcNAQkPMWwwajALBglghkgBZQMEASowCwYJYIZIAWUDBAEWMAsGCWCGSAFlAwQBAjAKBggqhkiG9w0DBzAOBggqhkiG9w0DAgICAIAwDQYIKoZIhvcNAwICAUAwBwYFKw4DAgcwDQYIKoZIhvcNAwICASgwCgYIKoZIzj0EAwIERjBEAiA5sS+hPdyeMxowMkTfcL/1iVsA9RdmF02kSp9kSSR7agIgZ3t7WylqMaIqf3I92PcF8fxxJjpg9LuuUeY74Csoplc=','base64');
 await assert.rejects(
  appleAppAttestReceiptService.verifyAppleSignedReceipt({
   ...context,nowMs:Date.parse('2026-11-13T17:00:00.000Z'),
   receiptB64url:fake.toString('base64url')}),
  /Untrusted|certificate|chain|signature|verify|issuer/i);
 const tampered=Buffer.from(fake);tampered[tampered.length-10]^=1;
 await assert.rejects(appleAppAttestReceiptService.verifyAppleSignedReceipt({
  ...context,receiptB64url:tampered.toString('base64url')}));
});


Deno.test('receipt DER rejects nonminimal lengths, wrong tags and truncated nested attributes',()=>{
 const valid=payload();
 const mutants:Uint8Array[]=[
  tlv(0x30,valid.subarray(valid[1]<128?2:4)), // SEQUENCE is not SET OF
  Buffer.from([0x31,0x80,0,0]), // indefinite-length BER is not valid DER
  Buffer.from([0x31,0x81,0x7f,...Buffer.alloc(0)]), // truncated long length
  Buffer.from([0x31,0x82,0,0x7f,...Buffer.alloc(0)]), // leading-zero length
  Buffer.from([0x31,0xff,0]), // too many length octets
  tlv(0x31,Buffer.concat([field(2,txt(context.appId)),Buffer.from([0x30,0x03,0x02,0x01])])),
  tlv(0x31,field(2,txt(context.appId)).subarray(0,5)), // truncated inner attribute
  tlv(0x31,Buffer.concat(Array.from({length:65},()=>field(2,txt('x'))))),
 ];
 for(const malformed of mutants)
  assert.throws(()=>inspectAppAttestReceiptPayload(malformed,context));
});
Deno.test('receipt attribute structure, integer encoding and text/date canonicality fail closed',()=>{
 const malformedAttr=(id:Uint8Array,version:Uint8Array,value:Uint8Array)=>
  tlv(0x31,seq(id,version,tlv(4,value)));
 const cases=[
  malformedAttr(tlv(2,Buffer.from([0,2])),tlv(2,Buffer.from([1])),txt(context.appId)),
  malformedAttr(tlv(2,Buffer.from([0x82])),tlv(2,Buffer.from([1])),txt(context.appId)),
  malformedAttr(tlv(2,Buffer.from([2])),tlv(2,Buffer.from([2])),txt(context.appId)),
  malformedAttr(tlv(2,Buffer.from([2])),tlv(2,Buffer.from([1])),Buffer.from([0x0c,0x80])),
  payload({12:time('2026-02-30T16:59:00.000Z')}),
  payload({12:time('2026-11-12T16:59:00+00:00')}),
  payload({12:time('2026-11-12T16:59:00.000Zextra')}),
  payload({2:txt('ABCDE12345.com.allin365.app\u0000')}),
  payload({4:Buffer.alloc(31,5)}),
  payload({4:Buffer.from('g'.repeat(64))}),
 ];
 for(const malformed of cases)
  assert.throws(()=>inspectAppAttestReceiptPayload(malformed,context));
});
Deno.test('CMS rejects corrupt signatures, altered certificate bytes and ambiguous envelopes',async()=>{
 // The real synthetic signed CMS fixture lives in the existing trust test.
 // These malformed envelopes must never turn into trusted Apple receipts.
 const invalid=[
  Buffer.from([0x30,0x80,0x00,0x00]), // indefinite length
  Buffer.from([0x30,0x02,0x06,0x00]), // malformed content-info OID
  Buffer.from([0x30,0x81,0x01,0x00]), // invalid long-form DER
  Buffer.from([0x30,0x82,0x10]), // truncated CMS container
  Buffer.alloc(12001,0x30), // receipt size limit
 ];
 for(const receipt of invalid)
  await assert.rejects(appleAppAttestReceiptService.verifyAppleSignedReceipt({
   ...context,receiptB64url:receipt.toString('base64url')}));
 for(const receipt of ['', '==', '+/8=', 'a', 'AA=', 'AA*A']){
  await assert.rejects(appleAppAttestReceiptService.verifyAppleSignedReceipt({
   ...context,receiptB64url:receipt}));
 }
});
