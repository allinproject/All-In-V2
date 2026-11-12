/** ALL-243 — server-only Apple App Attest signed-receipt verification.
 * No client-controlled root, trust assertion, or production endpoint.
 * Environment is proven by the separately verified AAGUID: Apple's signed
 * receipt has no independent sandbox/production field.
 */
import {createHash,createPublicKey,X509Certificate,timingSafeEqual} from 'node:crypto';
import {Certificate,ContentInfo,SignedData} from 'npm:pkijs@3.4.1';
import {APPLE_APP_ATTEST_ROOT_DER} from './appleAppAttestEnrollmentVerifier.ts';
import type {VerifiedAppleReceiptService} from './appleAppAttestEnrollmentServer.ts';
const MAX_RECEIPT_BYTES=12000;
const maxAge=300000;
const validApp=/^[A-Z0-9]{10}\.[a-zA-Z0-9.-]{3,180}$/;
const equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&timingSafeEqual(a,b);
function b64(value:string,bytes?:number):Buffer{
 if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length>20000)
  throw Error('Invalid Apple receipt base64url');
 const b=Buffer.from(value,'base64url');
 if(b.toString('base64url')!==value||(bytes!==undefined&&b.length!==bytes))
  throw Error('Invalid or noncanonical Apple receipt bytes');
 return b;
}
type TLV={tag:number;body:Buffer;end:number};
function read(b:Uint8Array,at:number):TLV{
 if(at<0||at+2>b.length)throw Error('Truncated receipt ASN.1');
 const tag=b[at++];let len=b[at++];
 if(len&128){
  const count=len&127;
  if(count<1||count>3||at+count>b.length||b[at]===0)
   throw Error('Invalid receipt DER length');
  len=0;for(let i=0;i<count;i++)len=len*256+b[at++];
  if(len<128)throw Error('Nonminimal receipt DER length');
 }
 if(len>b.length-at)throw Error('Truncated receipt DER value');
 return {tag,body:Buffer.from(b.slice(at,at+len)),end:at+len};
}
function elements(b:Uint8Array,tag:number):TLV[]{
 const outer=read(b,0);
 if(outer.tag!==tag||outer.end!==b.length)
  throw Error('Malformed Apple receipt container');
 const entries:TLV[]=[];let at=0;
 while(at<outer.body.length){
  if(entries.length>=64)throw Error('Excess Apple receipt fields');
  const v=read(outer.body,at);entries.push(v);at=v.end;
 }
 return entries;
}
function number(v:TLV):number{
 if(v.tag!==2||v.body.length<1||v.body.length>4||(v.body[0]&128))
  throw Error('Invalid receipt integer');
 if(v.body.length>1&&v.body[0]===0&&!(v.body[1]&128))
  throw Error('Noncanonical receipt integer');
 let n=0;for(const x of v.body)n=n*256+x;return n;
}
function string(v:Buffer):string{
 const item=read(v,0);
 if(item.end!==v.length||![12,19,22].includes(item.tag))
  throw Error('Malformed receipt string');
 const result=new TextDecoder('utf-8',{fatal:true}).decode(item.body);
 if(!result||result.length>256||/[\x00-\x1f\x7f]/.test(result))
  throw Error('Invalid receipt string');
 return result;
}
function date(v:Buffer):number{
 const s=string(v);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))
  throw Error('Invalid receipt timestamp');
 const ms=Date.parse(s);
 if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,19)!==s.slice(0,19))
  throw Error('Invalid receipt calendar time');
 return ms;
}
export type ReceiptContext={
 appId:string;keyId:string;publicKeySpkiBase64url:string;
 clientDataHashBase64url:string;environment:'sandbox'|'production';nowMs:number;
};
/** Parses only content already authenticated by CMS; NOT a trust decision. */
export function inspectAppAttestReceiptPayload(payload:Uint8Array,p:ReceiptContext){
 if(!Number.isSafeInteger(p.nowMs)||!validApp.test(p.appId)||
  !['sandbox','production'].includes(p.environment)||payload.length>4096)
  throw Error('Invalid receipt verification context');
 const fields=new Map<number,Buffer>();
 for(const a of elements(payload,0x31)){
  if(a.tag!==0x30)throw Error('Malformed receipt attribute');
  const parts:TLV[]=[];let at=0;
  while(at<a.body.length){const v=read(a.body,at);parts.push(v);at=v.end;}
  if(parts.length!==3||parts[2].tag!==4)
   throw Error('Malformed receipt attribute structure');
  const id=number(parts[0]),version=number(parts[1]);
  if(id<1||id>255||version!==1||fields.has(id))
   throw Error('Duplicate or invalid receipt attribute');
  fields.set(id,parts[2].body);
 }
 const field=(n:number)=>{const v=fields.get(n);
  if(!v)throw Error('Missing signed receipt field '+n);return v;};
 if(string(field(2))!==p.appId)throw Error('Receipt App ID mismatch');
 if(string(field(6))!=='ATTEST')
  throw Error('Enrollment requires original ATTEST receipt');
 const hash=field(4),expected=b64(p.clientDataHashBase64url,32);
 const ascii=hash.toString('ascii');
 const actual=hash.length===32?hash:
  /^[0-9a-fA-F]{64}$/.test(ascii)?Buffer.from(ascii,'hex'):Buffer.alloc(0);
 if(!equal(expected,actual))throw Error('Signed receipt challenge hash mismatch');
 const source=field(3),expectedSpki=b64(p.publicKeySpkiBase64url);
 let spki:Buffer;
 try{spki=new X509Certificate(source).publicKey.export({format:'der',type:'spki'});}
 catch{try{spki=createPublicKey({key:source,format:'der',type:'spki'})
  .export({format:'der',type:'spki'});}
  catch{throw Error('Invalid signed receipt public key');}}
 if(!equal(spki,expectedSpki))throw Error('Signed receipt public key mismatch');
 const key=createPublicKey({key:expectedSpki,format:'der',type:'spki'});
 const jwk=key.export({format:'jwk'}) as {kty?:string;crv?:string;x?:string;y?:string};
 if(jwk.kty!=='EC'||jwk.crv!=='P-256'||!jwk.x||!jwk.y)
  throw Error('Unexpected receipt key type');
 const point=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),
  Buffer.from(jwk.y,'base64url')]);
 if(!equal(createHash('sha256').update(point).digest(),b64(p.keyId,32)))
  throw Error('Signed receipt credential ID mismatch');
 const created=date(field(12));
 if(created>p.nowMs+30000||p.nowMs-created>maxAge)
  throw Error('Receipt creation time outside five-minute window');
 if(fields.has(21)&&date(field(21))<=p.nowMs)
  throw Error('Receipt has expired');
 // Field 19 means next eligible risk-metric refresh, not enrollment start.
 return {receiptType:'ATTEST' as const,creationTimeMs:created};
}
/** Validates one attached CMS signer and the full Apple-rooted cert path
 * before accessing the signed payload. Both checks must succeed.
 */
export const appleAppAttestReceiptService:VerifiedAppleReceiptService={
 async verifyAppleSignedReceipt(input){
  if(!Number.isSafeInteger(input.nowMs)||!validApp.test(input.appId))
   throw Error('Invalid receipt verification request');
  const bytes=b64(input.receiptB64url);
  if(!bytes.length||bytes.length>MAX_RECEIPT_BYTES)
   throw Error('Invalid receipt length');
  const envelope=ContentInfo.fromBER(bytes);
  if(envelope.contentType!==ContentInfo.SIGNED_DATA)
   throw Error('Apple receipt is not signed CMS data');
  const cms=new SignedData({schema:envelope.content});
  if(cms.signerInfos.length!==1||!cms.encapContentInfo.eContent)
   throw Error('Apple receipt must have one attached signer');
  const appleRoot=Certificate.fromBER(APPLE_APP_ATTEST_ROOT_DER);
  const verified=await cms.verify({signer:0,checkChain:true,
   trustedCerts:[appleRoot],checkDate:new Date(input.nowMs)});
  if(verified!==true)
   throw Error('Untrusted Apple receipt signature or certificate chain');
  const payload=new Uint8Array(cms.encapContentInfo.eContent.getValue());
  inspectAppAttestReceiptPayload(payload,input);
  return {trusted:true,receiptSha256:createHash('sha256').update(bytes).digest('hex')};
 },
};
