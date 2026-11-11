import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceIdentityKey,type ActivitySourceIdentity} from './completedActivitySourceReconciliation.ts';
import {reconcileCertifiedActivitySource,type CanonicalSourceCandidateSnapshot} from './completedActivitySourceCandidates.ts';
const source=():ActivitySourceIdentity=>({ownerId:'owner-A',provider:'apple_watch',sourceKind:'workout_record',
 sourceRecordId:'workout-1',revision:'1',payloadFingerprint:'sha-1',certifiedSessionInstanceId:'session-1'});
const snapshot=(a:ActivitySourceIdentity):CanonicalSourceCandidateSnapshot=>({
 ownerId:a.ownerId,sourceIdentityKey:sourceIdentityKey(a),
 scope:'source_identity_and_relevant_overlap',nextCursor:null,complete:true,readVersion:1,candidates:[],
});
test('certified complete no-match candidate can be handed to canonical writer',()=>{
 const a=source();
 assert.deepEqual(reconcileCertifiedActivitySource(a,snapshot(a)),{
  decision:'new_activity_candidate',activityId:null,reason:'distinct_source_no_verified_link',
 });
});
test('pagination or incomplete read cannot claim no source match',()=>{
 const a=source();
 for(const state of [{complete:false},{nextCursor:'page-2'}]){
  assert.deepEqual(reconcileCertifiedActivitySource(a,{...snapshot(a),...state}),{
   decision:'needs_review',activityId:null,reason:'incomplete_candidate_coverage',
  });
 }
});
test('wrong owner, wrong source key, and mixed owner candidates fail closed',()=>{
 const a=source();
 assert.throws(()=>reconcileCertifiedActivitySource(a,{...snapshot(a),ownerId:'other'}),/owner or identity/);
 assert.throws(()=>reconcileCertifiedActivitySource(a,{...snapshot(a),sourceIdentityKey:'other'}),/owner or identity/);
 assert.throws(()=>reconcileCertifiedActivitySource(a,{...snapshot(a),candidates:[{
  identity:{...a,ownerId:'other'},canonicalActivityId:'activity-1',
 }]}),/Cross-account/);
});
test('unverified scope and version fail closed',()=>{
 const a=source();
 assert.throws(()=>reconcileCertifiedActivitySource(a,{...snapshot(a),readVersion:0}),/Unverified/);
 assert.throws(()=>reconcileCertifiedActivitySource(a,{...snapshot(a),scope:'wrong' as 'source_identity_and_relevant_overlap'}),/Unverified/);
});
test('complete candidate snapshot still routes exact replay through original canonical policy',()=>{
 const a=source();
 const s=snapshot(a);
 assert.equal(reconcileCertifiedActivitySource(a,{...s,candidates:[{identity:a,canonicalActivityId:'completed-1'}]}).decision,'exact_replay');
});

test('foreign candidate data is denied even with unsupported provider or unfinished cursor',()=>{
 const a={...source(),provider:'garmin'};
 const foreign={identity:{...a,ownerId:'owner-B'},canonicalActivityId:'foreign-activity'};
 for(const patch of [{complete:false},{nextCursor:'more'},{}]){
  assert.throws(()=>reconcileCertifiedActivitySource(a,{
   ...snapshot(a),...patch,candidates:[foreign],
  }),/Cross-account/);
 }
 assert.throws(()=>reconcileCertifiedActivitySource(a,{
  ...snapshot(a),candidates:null as unknown as CanonicalSourceCandidateSnapshot['candidates'],
 }),/Cross-account/);
});
test('canonical SQL provider and kind names gate the certified owner reconciliation',()=>{
 const a=source();
 for(const patch of [
  {provider:'healthkit'},{provider:'garmin'},{provider:'coros'},
  {sourceKind:'fit_file'}
 ]){
  const incoming={...a,...patch};
  assert.deepEqual(reconcileCertifiedActivitySource(incoming,snapshot(incoming)),{
   decision:'needs_review',activityId:null,reason:'unsupported_provider_namespace',
  });
 }
 const health={...a,provider:'apple_healthkit'};
 assert.equal(reconcileCertifiedActivitySource(health,snapshot(health)).decision,
  'new_activity_candidate');
});
