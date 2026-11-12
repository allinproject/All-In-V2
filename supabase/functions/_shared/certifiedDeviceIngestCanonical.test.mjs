import test from 'node:test';
import assert from 'node:assert/strict';
import {signInternalDeviceEnvelope,ingestVerifiedDeviceEnvelopeTransactional}
 from './certifiedDeviceIngestServer.ts';
import {sourceIdentityKey} from '../../../apps/mobile-v2/src/features/training/completedActivitySourceReconciliation.ts';

const now=1770000000000,secret='server-internal-only-device-envelope-key-12345';
const bearer='verified-test-bearer-session-123456789';
const owner='11111111-1111-4111-8111-111111111111';
const another='22222222-2222-4222-8222-222222222222';
const sourceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const activityId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash='a'.repeat(64);
const payload={
 verifiedByProviderAdapter:true,
 identity:{ownerId:owner,provider:'apple_watch',sourceKind:'device_session',
  sourceRecordId:'watch-record',revision:'1',payloadFingerprint:hash,
  certifiedSessionInstanceId:'registered-session'},
 source:{activityId,ownerId:owner,sourceId,sourceQuality:'trusted',
  provider:'apple_watch',certifiedByServer:true},
 observations:[{metricCode:'heart_rate_bpm',definitionVersion:1,
  measurementKind:'source_measured',valueNumeric:72,valueText:null,
  valueBoolean:null,sampleQuality:'partial',sourcePayloadHash:hash}],
};
const nonce=(id)=>('nonce-'+id+'-').padEnd(28,'x');
async function signed(p=payload,id='original',at=now){
 return signInternalDeviceEnvelope(p,at,nonce(id),secret);
}
// A strict transactional fixture: signed callback, verified Auth session,
// registered source, one database lock, nonce ledger and canonical writer are
// one snapshot. Commit only on successful completion of the callback.
function database(){
 const db={owner,sessionId:'session-1',expiresAtMs:now+600000,
  active:true,registered:true,sourceOwner:owner,sourceProvider:'apple_watch',
  sourceRecord:'watch-record',usedNonces:new Set(),metrics:new Map(),
  authorizationChecks:0,rollbacks:0,commits:0,revocationOnAppend:false,
  failAppend:false,authOwner:owner};
 const backend={
  resolveUser:async token=>token===bearer?{
   ownerId:db.authOwner,sessionId:db.sessionId,expiresAtMs:db.expiresAtMs}:null,
  runOwnerTransaction:async (ownerId,work)=>{
   assert.equal(ownerId,db.authOwner);
   const stagedNonces=new Set(db.usedNonces);
   const stagedMetrics=new Map(db.metrics);
   const tx={
    authorizeActiveOwnerSource:async input=>{
     db.authorizationChecks++;
     return db.active&&db.expiresAtMs>input.nowMs&&
      input.ownerId===db.owner&&input.sessionId===db.sessionId&&
      input.activityId===activityId&&input.sourceId===sourceId&&
      input.provider===db.sourceProvider&&
      input.sourceRecordId===db.sourceRecord&&db.registered&&
      input.sourceKind==='device_session'&&
      input.certifiedSessionInstanceId==='registered-session'&&
      db.sourceOwner===input.ownerId;
    },
    consumeNonce:async ({nonce:n,ownerId,sourceId:id,sessionId})=>{
     if(stagedNonces.has(n)||ownerId!==db.owner||id!==sourceId||
       sessionId!==db.sessionId)return false;
     stagedNonces.add(n);return true;
    },
    writer:{
     findCandidates:async identity=>({
      ownerId:identity.ownerId,sourceIdentityKey:sourceIdentityKey(identity),
      scope:'source_identity_and_relevant_overlap',complete:true,nextCursor:null,
      readVersion:1,candidates:[{
       identity:{...identity,provider:'apple_healthkit',sourceRecordId:'related-record'},
       canonicalActivityId:activityId,
      }],
     }),
     appendVerifiedMeasurements:async args=>{
      if(db.failAppend)throw new Error('Canonical writer rejected upload');
      if(db.revocationOnAppend)db.active=false;
      assert.equal(args.identity.ownerId,ownerId);
      assert.equal(args.activityId,activityId);
      assert.equal(args.metrics.length,1);
      const key=args.metrics[0].sourceId+':'+args.metrics[0].metricCode;
      const prior=stagedMetrics.get(key);
      if(prior!==undefined){
       if(prior!==JSON.stringify(args.metrics[0]))
        throw new Error('Conflicting canonical source revision');
       return {activityId,outcome:'already_applied'};
      }
      stagedMetrics.set(key,JSON.stringify(args.metrics[0]));
      return {activityId,outcome:'appended'};
     },
    },
   };
   try{
    const outcome=await work(tx);
    db.usedNonces=stagedNonces;db.metrics=stagedMetrics;db.commits++;
    return outcome;
   }catch(err){db.rollbacks++;throw err;}
  },
 };
 return {db,backend};
}
async function ingest(e,backend,at=now,token=bearer){
 return ingestVerifiedDeviceEnvelopeTransactional(e,backend,token,secret,at);
}
test('active session and registered source append to canonical writer in one transaction',async()=>{
 const {db,backend}=database();
 assert.deepEqual(await ingest(await signed(),backend),{status:'written',activityId});
 assert.equal(db.metrics.size,1);
 assert.equal(db.usedNonces.size,1);
 assert.equal(db.authorizationChecks,2);
 assert.equal(db.commits,1);
});
test('expired, revoked and unrecognized bearer sessions are denied before any write',async()=>{
 for(const reason of ['expired','revoked','unknown']){
  const {db,backend}=database();
  if(reason==='expired')db.expiresAtMs=now-1;
  if(reason==='revoked')db.active=false;
  await assert.rejects(ingest(await signed(),backend,now,
   reason==='unknown'?'unrecognized-token-123456789':bearer),/session|bearer/i);
  assert.equal(db.metrics.size,0);assert.equal(db.usedNonces.size,0);
 }
});
test('account switch, another athlete source and unregistered device fail closed',async()=>{
 for(const reason of ['switch','foreign_source','unregistered','wrong_provider']){
  const {db,backend}=database();
  if(reason==='switch')db.authOwner=another;
  if(reason==='foreign_source')db.sourceOwner=another;
  if(reason==='unregistered')db.registered=false;
  if(reason==='wrong_provider')db.sourceProvider='supported_equipment';
  await assert.rejects(ingest(await signed(),backend),/mismatch|denied/);
  assert.equal(db.metrics.size,0);assert.equal(db.usedNonces.size,0);
 }
});
test('same nonce is rejected atomically; offline retry with new verified nonce is idempotent',async()=>{
 const {db,backend}=database();
 const first=await signed(payload,'offline-upload-a');
 assert.equal((await ingest(first,backend)).status,'written');
 await assert.rejects(ingest(first,backend),/replay|nonce/);
 assert.equal(db.metrics.size,1);
 // Device was offline; after reconnect, trusted adapter verifies the source
 // again and issues a fresh signed envelope (old HMAC is NOT reused).
 const retry=await signed(payload,'offline-upload-b',now+120000);
 assert.equal((await ingest(retry,backend,now+120000)).status,'already_applied');
 assert.equal(db.metrics.size,1);assert.equal(db.usedNonces.size,2);
});
test('offline packets cannot bypass signature freshness with an old envelope',async()=>{
 const {db,backend}=database();
 await assert.rejects(ingest(await signed(payload,'old-packet'),backend,now+300001),
  /expired/i);
 assert.equal(db.commits,0);
});
test('writer failure or mid-transaction session revocation rolls back nonce and metrics',async()=>{
 for(const fail of ['writer','revoked_during_write']){
  const {db,backend}=database();
  if(fail==='writer')db.failAppend=true;
  else db.revocationOnAppend=true;
  await assert.rejects(ingest(await signed(),backend),/writer|source changed/);
  assert.equal(db.commits,0);assert.equal(db.metrics.size,0);
  assert.equal(db.usedNonces.size,0);assert.equal(db.rollbacks,1);
 }
});
test('modified source identity is rejected before committing and failed nonce is reusable',async()=>{
 const {db,backend}=database();
 const altered={...payload,identity:{...payload.identity,sourceRecordId:'forged'}};
 await assert.rejects(ingest(await signed(altered,'identity-change'),backend),/denied/);
 assert.equal(db.usedNonces.size,0);
 assert.equal(db.metrics.size,0);
});
