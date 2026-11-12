import test from 'node:test';
import assert from 'node:assert/strict';
import {
 verifyAppleWatchControlAndIssueProof,watchDeviceReference,
 watchChallengePayload,phoneAppAssertionPayload,
} from './appleWatchOwnershipVerifier.ts';
import {verifyTrustedDeviceProof} from './certifiedDevicePairingServer.ts';

const now=1770000000000;
const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const challengeId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bearer='verified-apple-phone-session-123456';
const appId='ABCDE12345.com.allin365.app';
const secret='server-private-pairing-hmac-secret-123456789';
const encoder=new TextEncoder();
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const sha=async b=>new Uint8Array(await crypto.subtle.digest('SHA-256',b));
const b64=b=>Buffer.from(b).toString('base64url');
const cborLen=(major,n)=>n<24?[major<<5|n]:n<256?[major<<5|24,n]:[major<<5|25,n>>8,n&255];
function assertion(authData,signature){
 const fields=[['authenticatorData',authData],['signature',signature]];
 const out=[0xa2];
 for(const [name,value] of fields){
  const k=encoder.encode(name);
  out.push(...cborLen(3,k.length),...k,...cborLen(2,value.length),...value);
 }
 return b64(Uint8Array.from(out));
}
async function fixture(){
 const watch=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},
  true,['sign','verify']);
 const phone=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},
  true,['sign','verify']);
 const watchSpki=new Uint8Array(await crypto.subtle.exportKey('spki',watch.publicKey));
 const phoneSpki=new Uint8Array(await crypto.subtle.exportKey('spki',phone.publicKey));
 const fingerprint=hex(await sha(watchSpki));
 const deviceRef=watchDeviceReference(fingerprint);
 const state={
  challenge:{challengeId,ownerId:owner,sessionId:session,provider:'apple_watch',
   deviceRef,expiresAtMs:now+300000,consumedAtMs:null},
  key:{keyId:'apple-attested-phone-key-1',ownerId:owner,appId,
   publicKeySpkiB64url:b64(phoneSpki),signCount:0,
   appleAttestationVerifiedAtMs:now-200000,revokedAtMs:null},
  lastCount:0,issued:0,refuseAdvance:false,
 };
 const backend={
  resolveUser:async token=>token===bearer?{
   ownerId:owner,sessionId:session,expiresAtMs:now+500000}:null,
  withEvidenceTransaction:async (_id,fn)=>{
   const count=state.lastCount;
   try{
    const result=await fn({
     getChallenge:async()=>state.challenge,
     getAppleAttestedPhoneKey:async()=>state.key?{...state.key,
      signCount:state.lastCount}:null,
     advancePhoneCounter:async({previousCount,newCount})=>{
      if(state.refuseAdvance||state.lastCount!==previousCount||
       newCount<=previousCount)return false;
      state.lastCount=newCount;return true;
     },
    });
    return result;
   }catch(e){state.lastCount=count;throw e;}
  },
 };
 async function packet(counter=1){
  const watchBody=watchChallengePayload({challengeId,ownerId:owner,sessionId:session,deviceRef});
  const signedWatch=new Uint8Array(await crypto.subtle.sign({
   name:'ECDSA',hash:'SHA-256'},watch.privateKey,watchBody));
  const signatureHash=hex(await sha(signedWatch));
  const phonePayload=phoneAppAssertionPayload({
   challengeId,ownerId:owner,sessionId:session,deviceRef,watchSignatureHash:signatureHash,
  });
  const hash=await sha(encoder.encode(appId));
  const authData=new Uint8Array(37);
  authData.set(hash);authData[32]=0x01;
  new DataView(authData.buffer).setUint32(33,counter,false);
  const clientHash=await sha(phonePayload);
  const signature=new Uint8Array(await crypto.subtle.sign({
   name:'ECDSA',hash:'SHA-256'},phone.privateKey,
   await sha(Uint8Array.from([...authData,...clientHash]))));
  return {challengeId,watchPublicKeySpkiB64url:b64(watchSpki),
   watchSignatureB64url:b64(signedWatch),
   phoneAppAttestKeyId:'apple-attested-phone-key-1',
   phoneAssertionCborB64url:assertion(authData,signature)};
 }
 return {state,backend,packet};
}
async function verify(f,input,at=now){
 return verifyAppleWatchControlAndIssueProof(bearer,input,f.backend,
  secret,appId,at);
}
test('registered Apple-attested iPhone + watch key control signs existing pairing proof',async()=>{
 const f=await fixture(),p=await f.packet();
 const proof=await verify(f,p);
 assert.equal(proof.deviceRef,f.state.challenge.deviceRef);
 assert.equal(proof.provider,'apple_watch');
 assert.equal(proof.ownerId,owner);
 assert.equal(f.state.lastCount,1);
 assert.equal(await verifyTrustedDeviceProof(proof,secret,now),true);
});
test('watch signature forgery and substitution fail before any server certificate',async()=>{
 for(const kind of ['tamper','swap','challenge']){
  const f=await fixture(),p=await f.packet();
  if(kind==='tamper'){
   const b=Buffer.from(p.watchSignatureB64url,'base64url');
   b[4]^=1;p.watchSignatureB64url=b.toString('base64url');
  }
  if(kind==='swap'){
   p.watchPublicKeySpkiB64url=b64(new Uint8Array(await sha(encoder.encode('fake'))));
  }
  if(kind==='challenge')p.challengeId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await assert.rejects(verify(f,p));
  assert.equal(f.state.lastCount,0);
 }
});
test('phone app assertion cannot be forged or pointed at another app',async()=>{
 for(const kind of ['fake-app','signature','missing-key','revoked-key']){
  const f=await fixture(),p=await f.packet();
  if(kind==='fake-app')f.state.key.appId='ZZZZZ99999.com.other.app';
  if(kind==='signature'){
   const b=Buffer.from(p.phoneAssertionCborB64url,'base64url');
   b[b.length-3]^=1;p.phoneAssertionCborB64url=b.toString('base64url');
  }
  if(kind==='missing-key')f.state.key=null;
  if(kind==='revoked-key')f.state.key.revokedAtMs=now-1;
  await assert.rejects(verify(f,p));
  assert.equal(f.state.lastCount,0);
 }
});
test('same App Attest counter and same packet replay rejected; valid newer counter accepted',async()=>{
 const f=await fixture();
 await verify(f,await f.packet(1));
 await assert.rejects(verify(f,await f.packet(1)),/replay|registered/);
 assert.equal(f.state.lastCount,1);
 await verify(f,await f.packet(2));
 assert.equal(f.state.lastCount,2);
});
test('server challenge owner, expiry, and disabled CAS fail closed',async()=>{
 for(const kind of ['owner','expiry','consumed','cas']){
  const f=await fixture(),p=await f.packet();
  if(kind==='owner')f.state.challenge.ownerId='22222222-2222-4222-8222-222222222222';
  if(kind==='expiry')f.state.challenge.expiresAtMs=now-1;
  if(kind==='consumed')f.state.challenge.consumedAtMs=now-100;
  if(kind==='cas')f.state.refuseAdvance=true;
  await assert.rejects(verify(f,p));
  assert.equal(f.state.lastCount,0);
 }
});
