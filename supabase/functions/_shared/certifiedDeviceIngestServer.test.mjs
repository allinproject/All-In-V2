import test from 'node:test';
import assert from 'node:assert/strict';
import {signInternalDeviceEnvelope,ingestAuthenticatedDeviceEnvelope}
 from './certifiedDeviceIngestServer.ts';
import {sourceIdentityKey} from '../../../apps/mobile-v2/src/features/training/completedActivitySourceReconciliation.ts';
const now=1770000000000,secret='server-only-secret-material-at-least-32-chars';
const hash='a'.repeat(64);
const payload={
 verifiedByProviderAdapter:true,
 identity:{ownerId:'owner-a',provider:'apple_watch',sourceKind:'device_session',
  sourceRecordId:'watch-record',revision:'1',payloadFingerprint:hash,
  certifiedSessionInstanceId:'session-a'},
 source:{activityId:'activity-a',ownerId:'owner-a',sourceId:'source-a',
  sourceQuality:'trusted',provider:'apple_watch',certifiedByServer:true},
 observations:[{metricCode:'heart_rate_bpm',definitionVersion:1,
  measurementKind:'source_measured',valueNumeric:0,valueText:null,
  valueBoolean:null,sampleQuality:'partial',sourcePayloadHash:hash}],
};
function backend(){
 const seen=new Set();let writes=0;
 return {get writes(){return writes;},
  consumeNonceAndAuthorize:async ({nonce,ownerId,sourceId})=>{
   if(seen.has(nonce)||ownerId!=='owner-a'||sourceId!=='source-a')return false;
   seen.add(nonce);return true;
  },
  writer:{
   findCandidates:async identity=>({
    ownerId:identity.ownerId,sourceIdentityKey:sourceIdentityKey(identity),
    scope:'source_identity_and_relevant_overlap',complete:true,nextCursor:null,
    readVersion:2,candidates:[{identity:{...identity,provider:'apple_healthkit',
      sourceRecordId:'other'},canonicalActivityId:'activity-a'}],
   }),
   appendVerifiedMeasurements:async args=>{
    writes++;assert.equal(args.metrics[0].measurementQuality,'partial');
    assert.equal(args.metrics[0].valueNumeric,0);
    return {activityId:args.activityId,outcome:'appended'};
   },
  },
 };
}
test('signed internal envelope reaches canonical writer once',async()=>{
 const b=backend(),e=await signInternalDeviceEnvelope(payload,now,'nonce-unique-1234567890123456',secret);
 assert.deepEqual(await ingestAuthenticatedDeviceEnvelope(e,b,secret,now),
  {status:'written',activityId:'activity-a'});
 assert.equal(b.writes,1);
 await assert.rejects(ingestAuthenticatedDeviceEnvelope(e,b,secret,now),/replay/);
 assert.equal(b.writes,1);
});
test('tampered, expired and unauthorized callbacks never write',async()=>{
 const e=await signInternalDeviceEnvelope(payload,now,'nonce-unique-9876543210987654',secret);
 const b=backend();
 await assert.rejects(ingestAuthenticatedDeviceEnvelope(
  {...e,payload:{...payload,source:{...payload.source,ownerId:'other'}}},b,secret,now),/signature/);
 await assert.rejects(ingestAuthenticatedDeviceEnvelope(e,b,secret,now+300001),/Expired/);
 await assert.rejects(ingestAuthenticatedDeviceEnvelope(e,b,'wrong-secret-material-at-least-32-characters',now),/signature/);
 assert.equal(b.writes,0);
});
