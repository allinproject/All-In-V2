import test from 'node:test';
import assert from 'node:assert/strict';
import {assessV1RestrictionSourceManifest,V1_RESTRICTION_TABLES} from './all230-assess-v1-restriction-manifest.mjs';
const tableRows=V1_RESTRICTION_TABLES.map(name=>({name,count:name==='public.allin_training'?1:0,rowFingerprintMd5:'b'.repeat(32)}));
const observation={
 observationType:'v1_source_catalog_readonly',observedUtc:'2026-11-13T13:07:25Z',
 scopedTables:tableRows.map(t=>({table:t.name,rows:t.count})),
 trainingSignals:{training_rows:1,nonempty_limitation_rows:1,draft_object_rows:1},
};
const good=()=>({
 sourceProjectRef:'impulecgsgaruvniuttc',snapshotCutoffUtc:'2026-11-13T13:07:00Z',
 archiveSha256:'a'.repeat(64),sourceArchiveEncryptedAndAccessControlled:true,
 independentSourceAcquisitionReviewed:true,tables:tableRows.map(t=>({...t})),
 limitationMapping:{disposition:'independent_owner_review_complete',mappingEvidenceSha256:'c'.repeat(64)},
 legacyScopeIndependentlyComplete:true,
 importManifest:{providerInventoryIndependentlyVerified:true,
  sourceManifestSha256:'d'.repeat(64),jobCount:0,negativeZeroJobProofVerified:true},
});
test('perfect-looking metadata still cannot grant first certification or hosted restore',()=>{
 const reviewed=assessV1RestrictionSourceManifest(good(),observation);
 assert.deepEqual(reviewed,{metadataConsistent:true,reasons:[],
  reviewRequired:true,fullSourceAuthenticityEstablished:false,
  firstCertificationAuthorized:false,hostedRestoreAccepted:false});
});
test('live V1 limitation always prevents empty-history or unreviewed mapping claims',()=>{
 const m=good();delete m.limitationMapping;
 let x=assessV1RestrictionSourceManifest(m,observation);
 assert(x.reasons.includes('positive_legacy_limitation_unmapped'));
 assert.equal(x.firstCertificationAuthorized,false);
 x=assessV1RestrictionSourceManifest(good(),{...observation,
  trainingSignals:{...observation.trainingSignals,nonempty_limitation_rows:2}});
 assert.equal(x.firstCertificationAuthorized,false);
});
test('incomplete, tampered, drifted or untrusted source manifests fail closed',()=>{
 const changes=[
  m=>{m.sourceProjectRef='xarhuczrtzuiljmtdaeu';},
  m=>{m.snapshotCutoffUtc='';},
  m=>{m.archiveSha256='bad';},
  m=>{m.sourceArchiveEncryptedAndAccessControlled=false;},
  m=>{m.independentSourceAcquisitionReviewed=false;},
  m=>{m.tables.pop();},
  m=>{m.tables[0].rowFingerprintMd5='invalid';},
  m=>{m.tables.find(t=>t.name==='public.allin_training').count=0;},
  m=>{m.legacyScopeIndependentlyComplete=false;},
  m=>{m.importManifest.providerInventoryIndependentlyVerified=false;},
  m=>{m.importManifest.negativeZeroJobProofVerified=false;},
  m=>{m.importManifest.sourceManifestSha256='';},
 ];
 for(const change of changes){
  const m=good();change(m);
  const r=assessV1RestrictionSourceManifest(m,observation);
  assert.equal(r.metadataConsistent,false);
  assert.equal(r.fullSourceAuthenticityEstablished,false);
  assert.equal(r.hostedRestoreAccepted,false);
  assert(r.reasons.length>0);
 }
});
test('missing V1 live table observation does not become proof of a zero-row import',()=>{
 const r=assessV1RestrictionSourceManifest(good(),{
  ...observation,scopedTables:observation.scopedTables.slice(1),
 });
 assert(r.reasons.includes('incomplete_v1_observed_table_scope'));
 assert.equal(r.firstCertificationAuthorized,false);
});
