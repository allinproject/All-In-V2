import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileActivitySource,sourceIdentityKey,type ActivitySourceIdentity,
 type LinkedCanonicalSource} from './completedActivitySourceReconciliation.ts';
const source=(overrides:Partial<ActivitySourceIdentity>={}):ActivitySourceIdentity=>({
 ownerId:'owner-A',provider:'apple_watch',sourceKind:'workout_record',
 sourceRecordId:'watch-record-1',revision:'1',payloadFingerprint:'sha256-original',
 certifiedSessionInstanceId:'session-1',...overrides,
});
const linked=(identity:ActivitySourceIdentity,canonicalActivityId='activity-1'):LinkedCanonicalSource=>
 ({identity,canonicalActivityId});
test('same provider source identity and payload is exact replay, never second activity',()=>{
 assert.deepEqual(reconcileActivitySource(source(),[linked(source())]),{
  decision:'exact_replay',activityId:'activity-1',reason:'same_source_same_payload',
 });
});
test('source revision or changed bytes cannot silently overwrite canonical measurements',()=>{
 assert.equal(reconcileActivitySource(source({revision:'2'}),[linked(source())]).decision,'revision_review');
 assert.equal(reconcileActivitySource(source({payloadFingerprint:'sha256-new'}),[linked(source())]).decision,'revision_review');
});
test('Watch and HealthKit source IDs may attach only through certified identical Training session',()=>{
 const health=source({provider:'healthkit',sourceRecordId:'hk-91'});
 assert.deepEqual(reconcileActivitySource(health,[linked(source())]),{
  decision:'attach_certified_session',activityId:'activity-1',reason:'same_certified_session',
 });
 const unlinked=source({provider:'healthkit',sourceRecordId:'hk-91',certifiedSessionInstanceId:null});
 assert.equal(reconcileActivitySource(unlinked,[linked(source())]).decision,'needs_review');
});
test('even close/overlapping source records must not auto merge without certified session',()=>{
 const watch=source({certifiedSessionInstanceId:null});
 const fit=source({provider:'garmin',sourceRecordId:'garmin-fit-91',certifiedSessionInstanceId:null});
 assert.equal(reconcileActivitySource(fit,[linked(watch)]).decision,'needs_review');
});
test('same source pointing to two canonical activities blocks reconciliation',()=>{
 assert.deepEqual(reconcileActivitySource(source(),[linked(source()),linked(source(),'activity-2')]),{
  decision:'needs_review',activityId:null,reason:'conflicting_activity_links',
 });
});
test('same certified session linked to conflicting activities blocks reconciliation',()=>{
 const health=source({provider:'healthkit',sourceRecordId:'hk-91'});
 assert.equal(reconcileActivitySource(health,[linked(source()),linked(source({provider:'garmin',sourceRecordId:'fit-91'}),'activity-2')]).decision,'needs_review');
});
test('different owner cannot cause cross-user merging',()=>{
 const other=source({ownerId:'owner-B'});
 assert.equal(reconcileActivitySource(other,[linked(source())]).decision,'new_activity_candidate');
});
test('distinct source without overlapping candidates creates new-activity candidate, not ready activity ID',()=>{
 const result=reconcileActivitySource(source(),[]);
 assert.deepEqual(result,{decision:'new_activity_candidate',activityId:null,reason:'distinct_source_no_verified_link'});
});
test('provider external IDs remain exact and tuple-safe',()=>{
 const a=source({sourceRecordId:'id|segment'});
 const b=source({sourceRecordId:'id',sourceKind:'workout_record|segment'});
 assert.notEqual(sourceIdentityKey(a),sourceIdentityKey(b));
 assert.throws(()=>sourceIdentityKey(source({payloadFingerprint:''})),/Invalid activity source/);
});
test('exact provider source with newly certified or removed session needs review, not exact replay',()=>{
 const old=source({certifiedSessionInstanceId:null});
 assert.equal(reconcileActivitySource(source(),[linked(old)]).decision,'revision_review');
 assert.equal(reconcileActivitySource(old,[linked(source())]).decision,'revision_review');
});
test('source attached to different certified session cannot be silently reassigned',()=>{
 const result=reconcileActivitySource(source({certifiedSessionInstanceId:'session-2'}),[linked(source())]);
 assert.equal(result.decision,'needs_review');
});
