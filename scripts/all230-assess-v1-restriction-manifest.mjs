// ALL-230: independent REVIEW intake for a V1 restriction source archive.
// All inputs are metadata from a separately authenticated, approved,
// encrypted source snapshot. This NEVER validates signatures/provider custody,
// executes a dump, accepts patient text, or authorizes initial certification.
export const V1_RESTRICTION_TABLES=Object.freeze([
 'public.allin_training','public.allin_training_plan_versions',
 'public.allin_training_sessions','public.allin_workout_user_overrides',
 'public.allin_workout_plan_links','public.allin_coach_learnings',
 'public.allin_coach_thread_facts','public.allin_coach_thread_state',
 'public.allin_coaching_records','public.allin_workout_sync_sources',
 'public.allin_backup_restore_drills',
]);
const sha=/^[a-f0-9]{64}$/;
const md5=/^[a-f0-9]{32}$/;
const validTime=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const nonNegative=v=>Number.isSafeInteger(v)&&v>=0;
// Ensures an exact independently collected table inventory and detects the
// known existing legacy limitation rather than claiming an empty V1 source.
// Archive digest is required, but its authenticity remains a separate review.
export function assessV1RestrictionSourceManifest(manifest,observation) {
 const reasons=[];
 if(manifest?.sourceProjectRef!=='impulecgsgaruvniuttc')
  reasons.push('wrong_v1_source_project');
 if(!sha.test(manifest?.archiveSha256??''))
  reasons.push('missing_source_archive_sha256');
 if(!validTime(manifest?.snapshotCutoffUtc))
  reasons.push('missing_snapshot_cutoff');
 if(manifest?.sourceArchiveEncryptedAndAccessControlled!==true)
  reasons.push('unverified_encrypted_source_custody');
 if(manifest?.independentSourceAcquisitionReviewed!==true)
  reasons.push('missing_independent_source_acquisition_review');
 if(!Array.isArray(manifest?.tables)||manifest.tables.length!==V1_RESTRICTION_TABLES.length
   ||new Set(manifest.tables.map(t=>t?.name)).size!==V1_RESTRICTION_TABLES.length
   ||V1_RESTRICTION_TABLES.some(name=>!manifest.tables.some(t=>t?.name===name)))
  reasons.push('incomplete_v1_table_allowlist');
 for(const table of manifest?.tables??[]) {
  if(!V1_RESTRICTION_TABLES.includes(table?.name)
    ||!nonNegative(table?.count)||!md5.test(table?.rowFingerprintMd5??''))
   reasons.push('unverifiable_source_table_metadata');
 }
 if(observation?.observationType!=='v1_source_catalog_readonly'
  ||!validTime(observation?.observedUtc)
  ||!Array.isArray(observation?.scopedTables))
  reasons.push('invalid_v1_live_source_observation');
 const observed=new Map((observation?.scopedTables??[]).map(t=>[t?.table,t?.rows]));
 if(observed.size!==V1_RESTRICTION_TABLES.length
  ||V1_RESTRICTION_TABLES.some(name=>!nonNegative(observed.get(name))))
  reasons.push('incomplete_v1_observed_table_scope');
 for(const table of manifest?.tables??[])
  if(observed.has(table?.name)&&observed.get(table.name)!==table.count)
   reasons.push('live_source_vs_snapshot_row_count_drift');
 // The V1 limitation is REAL, but its private text must not be included in
 // the manifest; owner review of source archive is an out-of-band step.
 const signals=observation?.trainingSignals;
 if(!nonNegative(signals?.training_rows)
  ||!nonNegative(signals?.nonempty_limitation_rows)
  ||!nonNegative(signals?.draft_object_rows))
  reasons.push('invalid_legacy_limitation_signal_inventory');
 if(signals?.nonempty_limitation_rows>0){
  if(manifest?.limitationMapping?.disposition!=='independent_owner_review_complete'
    ||!sha.test(manifest?.limitationMapping?.mappingEvidenceSha256??''))
   reasons.push('positive_legacy_limitation_unmapped');
 }
 if(manifest?.legacyScopeIndependentlyComplete!==true)
  reasons.push('unattested_full_legacy_history_scope');
 if(manifest?.importManifest?.providerInventoryIndependentlyVerified!==true
  ||!sha.test(manifest?.importManifest?.sourceManifestSha256??'')
  ||!nonNegative(manifest?.importManifest?.jobCount)
  ||manifest?.importManifest?.negativeZeroJobProofVerified!==true)
  reasons.push('unattested_external_import_inventory');
 if(manifest?.legacyScopeIndependentlyComplete===true
   &&manifest?.importManifest?.providerInventoryIndependentlyVerified===true
   &&signals?.nonempty_limitation_rows>0
   &&manifest?.limitationMapping?.disposition!=='independent_owner_review_complete')
  reasons.push('cannot_attest_source_completeness_while_limitation_unmapped');
 return {metadataConsistent:reasons.length===0,reasons:[...new Set(reasons)],
  // Even matching metadata cannot prove the archive was acquired and sealed
  // independently, or that a V2 owner table/restore has been accepted.
  reviewRequired:true,fullSourceAuthenticityEstablished:false,
  firstCertificationAuthorized:false,hostedRestoreAccepted:false};
}
