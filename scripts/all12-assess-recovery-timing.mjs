// ALL-12 recovery timing acceptance: evidence-only; never initiates a restore.
// RPO is NOT a CI runtime or merely the age of a backup.
// A true measured recovery point requires attested source/target event watermarks.
const timestamp=(value)=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))?Date.parse(value):null;
export function assessRecoveryTiming(evidence) {
 const errors=[];
 const e=evidence&&typeof evidence==='object'&&!Array.isArray(evidence)?evidence:{};
 const names=['sourceFailureUtc','restoreStartedUtc','serviceReadyUtc','sourceLastCommittedUtc','restoredLastCommittedUtc','snapshotCutoffUtc'];
 const t=Object.fromEntries(names.map(k=>[k,timestamp(e[k])]));
 for(const k of names)if(t[k]===null)errors.push('missing_or_invalid_'+k);
 if(e.sourceProjectRef!=='xarhuczrtzuiljmtdaeu'||!e.restoreTargetRef||e.restoreTargetRef===e.sourceProjectRef)
  errors.push('nonisolated_or_wrong_restore_target');
 if(e.outboundDisabledBeforeImport!==true)errors.push('outbound_isolation_not_verified');
 if(e.snapshotIdentityVerified!==true)errors.push('snapshot_identity_unverified');
 if(e.domainIntegrityVerified!==true||e.authSignInVerified!==true||e.privateStorageBytesVerified!==true||
    e.ownerIsolationVerified!==true||e.servicesReadyVerified!==true)
  errors.push('service_or_domain_acceptance_incomplete');
 if(e.completeCommittedEventContinuityVerified!==true)errors.push('source_target_watermark_continuity_unverified');
 if(names.every(k=>t[k]!==null)){
  if(t.restoreStartedUtc<t.sourceFailureUtc||t.serviceReadyUtc<t.restoreStartedUtc)
   errors.push('invalid_recovery_chronology');
  if(t.snapshotCutoffUtc>t.sourceFailureUtc||t.restoredLastCommittedUtc>t.sourceLastCommittedUtc||
     t.sourceLastCommittedUtc>t.sourceFailureUtc||t.restoredLastCommittedUtc>t.snapshotCutoffUtc)
   errors.push('invalid_recovery_watermark_order');
 }
 if(!Number.isFinite(e.maximumRpoSeconds)||e.maximumRpoSeconds<0||!Number.isFinite(e.maximumRtoSeconds)||e.maximumRtoSeconds<0)
  errors.push('missing_reviewed_objectives');
 const measured=errors.length===0;
 const observedRpoSeconds=measured?(t.sourceLastCommittedUtc-t.restoredLastCommittedUtc)/1000:null;
 const observedRtoSeconds=measured?(t.serviceReadyUtc-t.sourceFailureUtc)/1000:null;
 const meetsObjectives=measured&&observedRpoSeconds<=e.maximumRpoSeconds&&observedRtoSeconds<=e.maximumRtoSeconds;
 return {measured,meetsObjectives,observedRpoSeconds,observedRtoSeconds,errors,releaseApproved:false};
}
