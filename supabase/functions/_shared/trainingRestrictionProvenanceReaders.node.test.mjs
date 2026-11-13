import test from 'node:test';
import assert from 'node:assert/strict';
import {
 readCanonicalHistoricalRestrictionSource,readCanonicalImportedTrainingSource,
 readCanonicalRestoredRestrictionSource,reconcileObservedRestrictionSources,
} from './trainingRestrictionProvenanceReaders.mjs';
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const snapshotVersion='review-19';
const retired={id:'r-retired',user_id:a,status:'retired',category:'exercise',
 subject:'lying leg curl',source:'explicit_user',source_ref:null,revision:2};
const active={id:'r-active',user_id:a,status:'active',category:'exercise',
 subject:'running',source:'explicit_user',source_ref:null,revision:1};
const approved={id:'r-imported',user_id:a,status:'active',category:'exercise',
 subject:'elliptical',source:'approved_plan',
 source_ref:'import-revision-1',revision:3};
const importedRevision={id:'import-revision-1',user_id:a,source_kind:'imported_template',
 status:'superseded',accepted_at:'2026-11-11T12:00:00Z'};
function clientFor({history=[retired],imports=[
 {user_id:a,kind:'imported_revision',record:importedRevision},
 {user_id:a,kind:'linked_restriction',record:approved},
 ]}={}) {
 const calls=[];
 return {calls,client:{query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql.includes("r.status='retired'")
   ?history.map(record=>({user_id:record.user_id,record}))
   :imports};
 }}};
}
test('historical Training source reads retired canonical rows but never asserts legacy completeness',async()=>{
 const f=clientFor();
 const r=await readCanonicalHistoricalRestrictionSource({
  client:f.client,ownerId:a,snapshotVersion});
 assert.equal(r.exhaustive,false);
 assert.deepEqual(r.records,[{user_id:a,record:retired}]);
 assert.match(r.coverageBlocker,/not independently attested/);
 assert.match(f.calls[0].sql,/r.status='retired'/);
 assert.match(f.calls[0].sql,/ORDER BY r.id LIMIT 201/);
 assert.deepEqual(f.calls[0].args,[a]);
});
test('imported Training source reads accepted imported-template revisions and links exact canonical refs',async()=>{
 const f=clientFor();
 const r=await readCanonicalImportedTrainingSource({
  client:f.client,ownerId:a,snapshotVersion});
 assert.equal(r.exhaustive,false);
 assert.deepEqual(r.observedUnresolvedMappings,[]);
 assert.equal(r.records[0].record.status,'superseded');
 assert.match(f.calls[0].sql,/source_kind='imported_template'/);
 assert.match(f.calls[0].sql,/accepted_at IS NOT NULL/);
 assert.match(f.calls[0].sql,/source='approved_plan'/);
 const review=reconcileObservedRestrictionSources({
  ownerId:a,currentRules:[retired,active,approved],
  history:await readCanonicalHistoricalRestrictionSource({
   client:f.client,ownerId:a,snapshotVersion}),
  imports:r,
 });
 assert.equal(review.recordedRules,3);
 assert.equal(review.observedRetired,1);
 assert.equal(review.observedImported,1);
 assert.equal(review.status,'blocked');
 assert.deepEqual(review.reasons,['independent_source_completeness_unverified']);
 assert.equal(review.firstCertificationAuthorized,false);
});
test('orphan approved-plan restriction provenance is rejected, never assumed to map to imported templates',async()=>{
 const f=clientFor({imports:[
  {user_id:a,kind:'imported_revision',record:importedRevision},
  {user_id:a,kind:'linked_restriction',record:{...approved,source_ref:'missing'}},
 ]});
 const r=await readCanonicalImportedTrainingSource({
  client:f.client,ownerId:a,snapshotVersion});
 assert.deepEqual(r.observedUnresolvedMappings,[approved.id]);
 const review=reconcileObservedRestrictionSources({
  ownerId:a,currentRules:[retired,approved],
  history:{ownerId:a,records:[{user_id:a,record:retired}],exhaustive:false},
  imports:r,
 });
 assert(review.reasons.includes('unresolved_imported_restriction_mapping'));
});
test('historical missing/altered retired rule blocks reconciliation',()=>{
 const base={ownerId:a,exhaustive:false};
 const imports={...base,records:[],observedUnresolvedMappings:[]};
 for(const history of [
  {...base,records:[]},
  {...base,records:[{user_id:a,record:{...retired,subject:'different'}}]},
  {...base,records:[{user_id:b,record:retired}]},
 ]) {
  const r=reconcileObservedRestrictionSources({
   ownerId:a,currentRules:[retired],history,imports});
  assert.equal(r.status,'blocked');
  assert(r.reasons.includes('missing_observed_retired_rule')
    ||r.reasons.includes('unmatched_historical_rule'));
 }
});
test('foreign owner and truncated source reads are rejected, not treated as empty',async()=>{
 for(const rows of [
  Array.from({length:201},()=>({user_id:a,record:retired})),
  [{user_id:b,record:{...retired,user_id:b}}],
 ]) {
  const f={query:async()=>({rows})};
  await assert.rejects(readCanonicalHistoricalRestrictionSource({
   client:f,ownerId:a,snapshotVersion}),/unbounded|foreign/);
  await assert.rejects(readCanonicalImportedTrainingSource({
   client:f,ownerId:a,snapshotVersion}),/unbounded|foreign/);
 }
});
test('restoration requires independent ALL-12 evidence even for empty account',async()=>{
 const f=clientFor();
 await assert.rejects(readCanonicalRestoredRestrictionSource({
  client:f.client,ownerId:a,snapshotVersion}),/independent restriction restoration proof unavailable/);
 assert.equal(f.calls.length,0);
});
