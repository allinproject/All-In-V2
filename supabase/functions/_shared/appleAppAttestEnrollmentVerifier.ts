/** ALL-243: staged App Attest enrollment certificate inspector; NO trust writer.
 * An Apple-attested iPhone key is trusted only after *separate* signed receipt
 * verification, live Auth, challenge consumption and a restricted DB writer.
 * Apple root cannot be supplied or changed by a client.
 */
import {X509Certificate,createHash} from 'node:crypto';
import {decode,decodeMultiple} from 'npm:cbor-x@1.6.0';
const ROOT="-----BEGIN CERTIFICATE-----\nMIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw\nJAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK\nQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa\nFw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv\nbiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y\nbmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh\nNbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au\nYen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/\nMB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw\nCgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn\n53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV\noyFraWVIyd/dganmrduC1bmTBGwD\n-----END CERTIFICATE-----";
const root=new X509Certificate(ROOT);
export const APPLE_ROOT_SHA256='1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932';
if(root.fingerprint256.replaceAll(':','').toLowerCase()!==APPLE_ROOT_SHA256)
 throw Error('Official Apple App Attestation root pin mismatch');
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest();
const same=(a:Uint8Array,b:Uint8Array)=>Buffer.from(a).equals(Buffer.from(b));
const raw=(v:unknown,max=20000)=>{
 if(!(v instanceof Uint8Array)||!v.length||v.length>max)
  throw Error('Invalid App Attest binary data');return Buffer.from(v);
};
function tlv(b:Uint8Array,offset:number){
 if(offset+2>b.length)throw Error('Invalid attestation DER');
 const tag=b[offset++];let n=b[offset++];
 if(n&128){const c=n&127;if(c<1||c>3||offset+c>b.length)throw Error('Invalid DER length');
  n=0;for(let i=0;i<c;i++)n=(n<<8)|b[offset++];if(n<128)throw Error('Nonminimal DER');}
 if(offset+n>b.length)throw Error('Truncated DER');
 return {tag,body:b.slice(offset,offset+n),end:offset+n};
}
const nonceOid=Buffer.from('2a864886f763640802','hex');
function appleNonce(leaf:Uint8Array){
 let found:Buffer|null=null;
 function walk(buf:Uint8Array,depth:number){
  if(depth>12)return;let at=0;
  while(at<buf.length){
   const t=tlv(buf,at);at=t.end;
   if(t.tag===6&&same(t.body,nonceOid)){
    const ext=tlv(buf,at);
    if(ext.tag!==4)throw Error('Malformed Apple nonce extension');
    const seq=tlv(ext.body,0);
    if(seq.tag!==0x30||seq.end!==ext.body.length)
     throw Error('Malformed Apple nonce sequence');
    const value=tlv(seq.body,0);
    if(value.tag!==4||value.body.length!==32||value.end!==seq.body.length||found)
     throw Error('Invalid or duplicated Apple nonce');
    found=Buffer.from(value.body);
   }
   if(t.tag&0x20)walk(t.body,depth+1);
  }
 }
 walk(leaf,0);if(!found)throw Error('Missing Apple attestation nonce');
 return found;
}
/** App Attest authData CBOR inspector, independent of certificate validity.
 * iOS 27+ may append launch metadata even when ED flag is clear. Older iOS
 * emits only the credential COSE key. Fail closed on trailing/unparseable data.
 * A passing result NEVER creates trust without the Apple certificate check.
 */
export function inspectAppAttestCredentialPayload(authData:Uint8Array,
 expectedPublicPoint:Uint8Array){
 if(authData.length<88||expectedPublicPoint.length!==65||
  expectedPublicPoint[0]!==4||!(authData[32]&0x40))
  throw Error('Missing attested App Attest credential');
 const values=decodeMultiple(Buffer.from(authData.slice(87)));
 if(!Array.isArray(values)||values.length<1||values.length>2)
  throw Error('Invalid or trailing App Attest CBOR credential');
 const field=(o:unknown,k:string|number):unknown=>o instanceof Map?
  o.get(k):(o&&typeof o==='object'?
   (o as Record<string,unknown>)[String(k)]:undefined);
 const key=values[0];
 const kty=field(key,1),alg=field(key,3),curve=field(key,-1);
 const x=field(key,-2),y=field(key,-3);
 if(kty!==2||alg!==-7||curve!==1||
   !(x instanceof Uint8Array)||!(y instanceof Uint8Array)||
   x.length!==32||y.length!==32||
   !same(Buffer.concat([Buffer.from([4]),Buffer.from(x),Buffer.from(y)]),expectedPublicPoint))
  throw Error('App Attest COSE P-256 key differs from certificate');
 let category:unknown=null,bundleVersion:unknown=null;
 if(values.length===2){
  const ext=values[1];
  category=field(ext,'apple_validation_category_01');
  bundleVersion=field(ext,'apple_bundle_version_01');
  if(category instanceof Uint8Array){
   if(category.length!==4)throw Error('Invalid Apple validation category bytes');
   category=Buffer.from(category).readUInt32LE(0);
  }
  if(!Number.isInteger(category)||![2,3,4,5].includes(category as number)||
    typeof bundleVersion!=='string'||bundleVersion.length<1||
    bundleVersion.length>64||!/^[a-zA-Z0-9._-]+$/.test(bundleVersion))
   throw Error('Unexpected Apple application launch category or version');
 }
 return {validationCategory:category as number|null,bundleVersion:bundleVersion as string|null};
}
export function appAttestChallengeData(owner:string,session:string,challenge:string,appId:string){
 if(![owner,session,challenge].every(v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)))
  throw Error('Invalid authenticated App Attest challenge');
 return Buffer.from(JSON.stringify(['ALL-IN-365-APP-ATTEST-ENROLL-V1',owner,session,challenge,appId]));
}
/** A certificate inspection result is NOT permission to INSERT a trusted key. */
export function inspectAppleAppAttestation(input:{
 attestationB64url:string;keyId:string;appId:string;
 challengeData:Uint8Array;environment:'production'|'sandbox';nowMs:number;
}){
 if(!/^[A-Za-z0-9_-]{100,20000}$/.test(input.attestationB64url))
  throw Error('Malformed App Attest object');
 const obj=decode(Buffer.from(input.attestationB64url,'base64url'));
 if(!obj||obj.fmt!=='apple-appattest'||!obj.attStmt||
  !Array.isArray(obj.attStmt.x5c)||obj.attStmt.x5c.length!==2)
  throw Error('Invalid App Attest chain');
 const leaf=new X509Certificate(raw(obj.attStmt.x5c[0],4096));
 const ca=new X509Certificate(raw(obj.attStmt.x5c[1],4096));
 if(!leaf.checkIssued(ca)||!leaf.verify(ca.publicKey)||
  !ca.checkIssued(root)||!ca.verify(root.publicKey))
  throw Error('Apple App Attest certificate chain not trusted');
 if(!Number.isSafeInteger(input.nowMs)||[leaf,ca,root].some(c=>
  input.nowMs<Date.parse(c.validFrom)||input.nowMs>Date.parse(c.validTo)))
  throw Error('Expired attestation certificate');
 const a=raw(obj.authData,4096);
 if(a.length<164||!(a[32]&0x40)||!same(a.slice(0,32),hash(Buffer.from(input.appId)))||
  a.readUInt32BE(33)!==0)
  throw Error('Wrong App Attest app identity, flags or counter');
 const guid=a.slice(37,53);
 // Apple documents 'appattestsandbox' for sandbox; earlier App Attest
 // examples also used 'appattestdevelop'. Neither is accepted in production.
 const validGuid=input.environment==='sandbox'?
  [Buffer.from('appattestsandbox'),Buffer.from('appattestdevelop')]
   .some(expected=>same(guid,expected)):
  same(guid,Buffer.concat([Buffer.from('appattest'),Buffer.alloc(7)]));
 if(!validGuid||a.readUInt16BE(53)!==32)
  throw Error('App Attest environment or credential length mismatch');
 const id=Buffer.from(input.keyId,'base64url');
 if(id.length!==32||!same(a.slice(55,87),id))
  throw Error('App Attest credential ID mismatch');
 const jwk=leaf.publicKey.export({format:'jwk'}) as {kty?:string;crv?:string;x?:string;y?:string};
 if(jwk.kty!=='EC'||jwk.crv!=='P-256'||!jwk.x||!jwk.y)
  throw Error('App Attest key is not P-256');
 const point=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 if(point.length!==65||!same(hash(point),id))
  throw Error('Apple certificate public key ID mismatch');
 const launch=inspectAppAttestCredentialPayload(a,point);
 const nonce=hash(Buffer.concat([a,hash(input.challengeData)]));
 if(!same(appleNonce(leaf.raw),nonce))
  throw Error('Apple certificate nonce/challenge mismatch');
 if(!obj.attStmt.receipt)throw Error('Apple signed receipt missing');
 return {keyId:input.keyId,appId:input.appId,environment:input.environment,
  publicKeySpkiBase64url:leaf.publicKey.export({format:'der',type:'spki'}).toString('base64url'),
  receiptB64url:raw(obj.attStmt.receipt,12000).toString('base64url'),
  leafFingerprint:leaf.fingerprint256.replaceAll(':','').toLowerCase(),
  validationCategory:launch.validationCategory,
  bundleVersion:launch.bundleVersion,
  reviewedOnly:true as const};
}
