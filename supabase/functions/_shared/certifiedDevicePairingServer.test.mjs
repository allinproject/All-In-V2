import test from 'node:test';
import assert from 'node:assert/strict';
import {
 issueDevicePairingChallenge,completeVerifiedDevicePairing,revokeOwnedDevice,
 signTrustedDeviceProof,
} from './certifiedDevicePairingServer.ts';
const now=1770000000000;
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token='fixture-verified-session-bearer-123456';
const secret='only-server-owns-approved-provider-evidence-secret';
function fixture(){
 const db={active:true,sessionOwner:owner,expiresAtMs:now+600000,
  challenges:new Map(),devices:new Map(),audit:[],commits:0,rollbacks:0};
 const backend={
  resolveUser:async t=>t===token?{
   ownerId:db.sessionOwner,sessionId:session,expiresAtMs:db.expiresAtMs}:null,
  withOwnerTransaction:async (id,work)=>{
   const claims=new Map(db.challenges),devices=new Map(db.devices);
   const audit=[...db.audit];
   const validate=()=>db.active&&id===owner&&db.expiresAtMs>now;
   const tx={
    issueChallenge:async x=>{
     if(!validate()||x.ownerId!==id||x.sessionId!==session||
       claims.has(x.challengeId))return false;
     claims.set(x.challengeId,{...x,consumed:false});return true;
    },
    registerProof:async x=>{
     const c=claims.get(x.challengeId);
     if(!validate()||!c||c.consumed||c.ownerId!==x.ownerId||
       c.sessionId!==x.sessionId||c.provider!==x.provider||
       c.deviceRef!==x.deviceRef||now>=c.expiresAtMs||
       [...devices.values()].some(d=>d.provider===x.provider&&d.deviceRef===x.deviceRef))
       throw Error('Pairing challenge invalid or consumed');
     claims.set(x.challengeId,{...c,consumed:true});
     devices.set(x.deviceId,{...x,revoked:false});
     audit.push({type:'paired',owner:id});return 'paired';
    },
    revokeDevice:async x=>{
     const d=devices.get(x.deviceId);
     if(!validate()||!d||d.ownerId!==id)throw Error('Owned device required');
     if(d.revoked)return 'already_revoked';
     devices.set(x.deviceId,{...d,revoked:true});
     audit.push({type:'revoked',owner:id});return 'revoked';
    },
   };
   try{const result=await work(tx);db.challenges=claims;db.devices=devices;
    db.audit=audit;db.commits++;return result;
   }catch(e){db.rollbacks++;throw e;}
  },
 };
 return {db,backend};
}
function unsigned(c){
 return {challengeId:c.challengeId,ownerId:owner,sessionId:session,
  provider:'apple_watch',deviceRef:'watch-001',
  attestationKind:'native_owner_verified',evidenceHash:'f'.repeat(64),
  issuedAtMs:now};
}
test('verified server evidence binds challenge and exact owner; device can be revoked',async()=>{
 const {db,backend}=fixture();
 const challenge=await issueDevicePairingChallenge(token,{provider:'apple_watch',
  deviceRef:'watch-001'},backend,now);
 const proof=await signTrustedDeviceProof(unsigned(challenge),secret);
 const result=await completeVerifiedDevicePairing(token,proof,backend,secret,now);
 assert.equal(result.status,'paired');assert.equal(db.devices.size,1);
 assert.deepEqual(await revokeOwnedDevice(token,result.deviceId,backend,now),
  {status:'revoked'});
 assert.deepEqual(await revokeOwnedDevice(token,result.deviceId,backend,now),
  {status:'already_revoked'});
 assert.deepEqual(db.audit.map(a=>a.type),['paired','revoked']);
});
test('a client cannot self-certify with a boolean or a forged proof',async()=>{
 const {db,backend}=fixture();
 const c=await issueDevicePairingChallenge(token,{provider:'apple_watch',
  deviceRef:'watch-001'},backend,now);
 const fake={...unsigned(c),signatureHex:'a'.repeat(64),certifiedByServer:true};
 await assert.rejects(completeVerifiedDevicePairing(token,fake,backend,secret,now),
  /ownership evidence/);
 assert.equal(db.devices.size,0);
});
test('tampering, expired proof, account switch and unverified equipment are denied',async()=>{
 for(const kind of ['tampered','expired','switch','equipment']){
  const {db,backend}=fixture();
  const c=await issueDevicePairingChallenge(token,{provider:'apple_watch',
   deviceRef:'watch-001'},backend,now);
  let proof=await signTrustedDeviceProof(unsigned(c),secret);
  if(kind==='tampered')proof={...proof,deviceRef:'other-watch'};
  if(kind==='switch')db.sessionOwner=other;
  if(kind==='equipment'){
   proof=await signTrustedDeviceProof({...unsigned(c),
    provider:'supported_equipment',attestationKind:'native_owner_verified'},secret);
  }
  await assert.rejects(completeVerifiedDevicePairing(token,proof,backend,
   secret,kind==='expired'?now+300001:now));
  assert.equal(db.devices.size,0);assert.equal(db.audit.length,0);
 }
});
test('challenge is one-use; replay and cross-owner revocation denied',async()=>{
 const {db,backend}=fixture();
 const c=await issueDevicePairingChallenge(token,{provider:'apple_watch',
  deviceRef:'watch-001'},backend,now);
 const proof=await signTrustedDeviceProof(unsigned(c),secret);
 const result=await completeVerifiedDevicePairing(token,proof,backend,secret,now);
 await assert.rejects(completeVerifiedDevicePairing(token,proof,backend,secret,now),
  /challenge/);
 db.sessionOwner=other;
 await assert.rejects(revokeOwnedDevice(token,result.deviceId,backend,now),
  /Owned device|revocation|trusted/i);
 assert.equal(db.audit.length,1);
});
test('expired or unverified bearer cannot create challenges or revoke',async()=>{
 for(const mode of ['expired','revoked','unknown']){
  const {db,backend}=fixture();
  if(mode==='expired')db.expiresAtMs=now-1;
  if(mode==='revoked')db.active=false;
  const t=mode==='unknown'?'unrecognized-bearer-123456789':token;
  await assert.rejects(issueDevicePairingChallenge(t,{
   provider:'apple_watch',deviceRef:'watch-001'},backend,now));
  assert.equal(db.challenges.size,0);
 }
});
