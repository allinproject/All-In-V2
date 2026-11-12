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
