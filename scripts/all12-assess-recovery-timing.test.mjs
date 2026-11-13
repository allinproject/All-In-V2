import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecoveryTiming} from './all12-assess-recovery-timing.mjs';
const valid={
 sourceProjectRef:'xarhuczrtzuiljmtdaeu',restoreTargetRef:'disposable-recovery-target',
 outboundDisabledBeforeImport:true,snapshotIdentityVerified:true,
 domainIntegrityVerified:true,authSignInVerified:true,privateStorageBytesVerified:true,
 ownerIsolationVerified:true,servicesReadyVerified:true,completeCommittedEventContinuityVerified:true,
 sourceFailureUtc:'2026-11-13T15:00:00Z',restoreStartedUtc:'2026-11-13T15:03:00Z',
 serviceReadyUtc:'2026-11-13T15:12:00Z',snapshotCutoffUtc:'2026-11-13T14:58:00Z',
 restoredLastCommittedUtc:'2026-11-13T14:57:30Z',
 sourceLastCommittedUtc:'2026-11-13T14:59:30Z',
 maximumRpoSeconds:180,maximumRtoSeconds:900,
};
test('attested example computes only measured RPO and RTO; never release approval',()=>{
 const result=assessRecoveryTiming(valid);
 assert.equal(result.measured,true);assert.equal(result.meetsObjectives,true);
 assert.equal(result.observedRpoSeconds,120);assert.equal(result.observedRtoSeconds,720);
 assert.equal(result.releaseApproved,false);
});
test('missing hosted restore, identity or private files never produces invented metrics',()=>{
 for(const field of ['sourceProjectRef','restoreTargetRef','snapshotIdentityVerified','authSignInVerified',
   'privateStorageBytesVerified','completeCommittedEventContinuityVerified','servicesReadyVerified',
   'maximumRpoSeconds']){
  const result=assessRecoveryTiming({...valid,[field]:null});
  assert.equal(result.measured,false,field);
  assert.equal(result.observedRpoSeconds,null,field);
  assert.equal(result.observedRtoSeconds,null,field);
 }
 assert.equal(assessRecoveryTiming({}).measured,false);
});
test('reject invalid ordering, source reuse and broken outbound isolation',()=>{
 for(const patch of [
 {restoreTargetRef:valid.sourceProjectRef},{outboundDisabledBeforeImport:false},
 {snapshotCutoffUtc:'2026-11-13T15:01:00Z'},
 {restoredLastCommittedUtc:'2026-11-13T14:59:00Z'},
 {serviceReadyUtc:'2026-11-13T14:50:00Z'},
 {sourceFailureUtc:'not-a-time'}
 ])assert.equal(assessRecoveryTiming({...valid,...patch}).measured,false,JSON.stringify(patch));
});
test('honest out-of-objective measurements are not accepted',()=>{
 const result=assessRecoveryTiming({...valid,maximumRtoSeconds:600});
 assert.equal(result.measured,true);assert.equal(result.meetsObjectives,false);
 assert.equal(result.observedRtoSeconds,720);
});
