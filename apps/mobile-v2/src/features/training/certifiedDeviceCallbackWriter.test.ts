import test from 'node:test';
import assert from 'node:assert/strict';
import {routeVerifiedDeviceCallback,type VerifiedDeviceCallback,type CanonicalDeviceWriter}
 from './certifiedDeviceCallbackWriter.ts';
import {sourceIdentityKey} from './completedActivitySourceReconciliation.ts';
const hash='a'.repeat(64);
const cb:VerifiedDeviceCallback={
 verifiedByProviderAdapter:true,
 identity:{ownerId:'owner-a',provider:'apple_watch',sourceKind:'device_session',
  sourceRecordId:'provider-123',revision:'1',payloadFingerprint:hash,
  certifiedSessionInstanceId:'session-a'},
 source:{ownerId:'owner-a',activityId:'activity-a',sourceId:'source-a',
  provider:'apple_watch',sourceQuality:'trusted',certifiedByServer:true},
 observations:[{metricCode:'power_w',definitionVersion:1,measurementKind:'source_measured',
  valueNumeric:0,valueText:null,valueBoolean:null,sampleQuality:'partial',sourcePayloadHash:hash}],
};
const writer=(candidates:CanonicalDeviceWriter['findCandidates'] extends (...a:any)=>Promise<infer T>?T:never,
 onWrite:()=>void):CanonicalDeviceWriter=>({
 findCandidates:async()=>candidates,
 appendVerifiedMeasurements:async args=>{onWrite();
  assert.equal(args.activityId,'activity-a');
  assert.equal(args.metrics[0].valueNumeric,0);
  assert.equal(args.metrics[0].measurementQuality,'partial');
  return {activityId:args.activityId,outcome:'appended'};
 },
});
const snapshot=(candidates:readonly any[]=[])=>({
 ownerId:'owner-a',sourceIdentityKey:sourceIdentityKey(cb.identity),
 scope:'source_identity_and_relevant_overlap' as const,nextCursor:null,complete:true,
 readVersion:3,candidates,
});
test('only server-certified same-session identity reaches canonical writer',async()=>{
 let writes=0;
 const other={...cb.identity,provider:'apple_healthkit',sourceRecordId:'other'};
 const result=await routeVerifiedDeviceCallback(cb,writer(snapshot([
  {identity:other,canonicalActivityId:'activity-a'},
 ]),()=>writes++));
 assert.deepEqual(result,{status:'written',activityId:'activity-a'});
 assert.equal(writes,1);
});
test('exact replay never writes a second measurement',async()=>{
 let writes=0;
 const result=await routeVerifiedDeviceCallback(cb,writer(snapshot([
  {identity:cb.identity,canonicalActivityId:'activity-a'},
 ]),()=>writes++));
 assert.equal(result.status,'already_applied');assert.equal(writes,0);
});
test('unlinked source and corrected revisions require review, not automatic insert',async()=>{
 let writes=0;
 const w=()=>writes++;
 const first=await routeVerifiedDeviceCallback(cb,writer(snapshot(),w));
 assert.equal(first.status,'review_required');
 const changed={...cb.identity,revision:'older'};
 const second=await routeVerifiedDeviceCallback(cb,writer(snapshot([
  {identity:changed,canonicalActivityId:'activity-a'},
 ]),w));
 assert.equal(second.status,'review_required');assert.equal(writes,0);
});
test('forged callback, owner mismatch and mixed sample payloads fail before writer',async()=>{
 let writes=0;
 const w=writer(snapshot(),()=>writes++);
 for(const bad of [
  {...cb,verifiedByProviderAdapter:false as true},
  {...cb,source:{...cb.source,ownerId:'owner-b'}},
  {...cb,observations:[{...cb.observations[0],sourcePayloadHash:'b'.repeat(64)}]},
 ]){
  await assert.rejects(routeVerifiedDeviceCallback(bad,w));
 }
 assert.equal(writes,0);
});
