import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrainingRestrictionSourceReaderCandidate,readCanonicalCurrentRestrictionSource,TRAINING_RESTRICTION_SOURCES} from './trainingRestrictionSourceReader.mjs';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const version='owner-snapshot-12';
const fingerprint='e'.repeat(32);
const signedFixtureToken=['eyJhbGciOiJIUzI1NiJ9',
 Buffer.from(JSON.stringify({sub:owner,session_id:session})).toString('base64url'),
 'test-signature'].join('.');
function fixture(options={}) {
 const calls=[];let released=false,authReads=0,readers=0,reconciled=0;
 const client={
  async query(sql,args){
   calls.push({sql,args});
   if(sql==='BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE'||sql.startsWith('SET LOCAL')
      ||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('set_config('))
    return {rows:[]};
   if(sql.includes('inventory_digest_candidate'))return {rows:[{digest:fingerprint}]};
   if(sql.startsWith('SELECT * FROM public.v2_training_athlete_restrictions'))return {rows:[]};
   if(sql.includes('ingest_restriction_source_evidence_candidate')) {
    const sources=JSON.parse(args[2]);
    assert.equal(sources.length,5);
    assert.equal(args[0],owner);
    assert.equal(args[1],version);
    for(const s of sources){
     assert.match(s.inventoryDigest,/^[a-f0-9]{64}$/);
     assert.equal(s.canonicalInventoryDigest,fingerprint);
     assert.equal(s.complete,true);
     assert.equal(s.reconciledCount,s.inspectedCount);
    }
    return {rows:[{payload:{ownerId:owner,snapshotVersion:version,
      recordedInventoryDigest:fingerprint,status:'review_required',
      sourceAuthenticityEstablished:false,initialCertificationAuthorized:false}}]};
   }
   throw Error('Unexpected SQL: '+sql);
  },release(){released=true;},
 };
 const sourceReaders=Object.fromEntries(TRAINING_RESTRICTION_SOURCES.slice(1).map(kind=>[kind,async args=>{
  readers++;
  assert.equal(args.client,client);
  const rows=options.foreignKind===kind?[{id:'x',user_id:other}]:
   options.rowsKind===kind?[{id:'x',user_id:owner}]:[];
  return {ownerId:options.wrongOwnerKind===kind?other:owner,snapshotVersion:version,
   exhaustive:options.partialKind!==kind,nextCursor:null,
   evidenceRef:'trusted:'+kind,records:rows};
 }]));
 if(options.missingKind)delete sourceReaders[options.missingKind];
 const ingest=createTrainingRestrictionSourceReaderCandidate;
 const instance=()=>ingest({
  pool:{connect:async()=>client},
  authClient:{auth:{getUser:async()=>{authReads++;return {data:{user:{id:owner}}};}}},
  sourceReaders,
  reconcileSource:async ({kind,records})=>{
   reconciled++;
   return {reconciledCount:options.unresolvedKind===kind?0:records.length,
    unresolvedCount:options.unresolvedKind===kind?1:0};
  },
 });
 return {instance,calls,get released(){return released;},
  get authReads(){return authReads;},get readers(){return readers;},
  get reconciled(){return reconciled;}};
}
test('server reader binds all five exact sources to same serializable Auth session, inserts once',async()=>{
 const f=fixture();
 const receipt=await f.instance().ingestReviewedSources({bearerToken:signedFixtureToken,snapshotVersion:version});
 assert.equal(receipt.status,'review_required');
 assert.equal(f.authReads,1);
 assert.equal(f.readers,4);
 assert.equal(f.reconciled,5);
 assert.equal(f.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
 assert(f.calls.some(c=>c.sql.includes('request.jwt.claim.sub')&&c.args[0]===owner));
 assert(f.calls.some(c=>c.sql.includes('request.jwt.claim.session_id')&&c.args[0]===session));
 assert.equal(f.calls.filter(c=>c.sql.includes('ingest_restriction_source_evidence_candidate')).length,1);
 assert.equal(f.calls.at(-1).sql,'COMMIT');
 assert.equal(f.released,true);
});
test('missing source dependency rejects before connecting or ingesting',()=>{
 const f=fixture({missingKind:'historical_records'});
 assert.throws(f.instance,/All trusted Training source readers/);
});
test('partial, cross-owner and unreconciled source records roll back with no ingest',async()=>{
 for(const options of [
  {partialKind:'approved_plans'},{wrongOwnerKind:'historical_records'},
  {foreignKind:'restored_records'},{unresolvedKind:'imported_records',rowsKind:'imported_records'},
 ]) {
  const f=fixture(options);
  await assert.rejects(f.instance().ingestReviewedSources({
   bearerToken:signedFixtureToken,snapshotVersion:version,
  }),/complete owner-bound|foreign\/malformed|Unresolved/);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  assert.equal(f.calls.some(x=>x.sql.includes('ingest_restriction_source_evidence_candidate')),false);
  assert.equal(f.released,true);
 }
});
test('unverified owner/session refused before acquiring private pool',async()=>{
 let connected=false;
 const readers=Object.fromEntries(TRAINING_RESTRICTION_SOURCES.slice(1).map(kind=>[kind,async()=>{}]));
 const r=createTrainingRestrictionSourceReaderCandidate({
  pool:{connect:async()=>{connected=true;throw Error('should not connect');}},
  sourceReaders:readers,reconcileSource:async()=>{},
  authClient:{auth:{getUser:async()=>({error:Error('revoked')})}},
 });
 await assert.rejects(r.ingestReviewedSources({bearerToken:'bad',snapshotVersion:version}),/Verified/);
 assert.equal(connected,false);
});
test('stale or unexpectedly certified DB receipts roll back',async()=>{
 const f=fixture();
 const reader=f.instance();
 // The database stub is strict; use a distinct deliberately bad receipt.
 let released=false;
 const db={query:async(sql)=>{
  if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL')||sql==='ROLLBACK'
     ||sql.includes('set_config('))return {rows:[]};
  if(sql.includes('inventory_digest_candidate'))return {rows:[{digest:fingerprint}]};
  if(sql.startsWith('SELECT * FROM public.v2_training_athlete_restrictions'))return {rows:[]};
  if(sql.includes('ingest_restriction_source_evidence_candidate'))return {rows:[{
   payload:{ownerId:owner,snapshotVersion:version,status:'certified',
    initialCertificationAuthorized:true,sourceAuthenticityEstablished:true,
    recordedInventoryDigest:fingerprint},
  }]};
  throw Error('Unexpected SQL');
 },release:()=>{released=true;}};
 const readers=Object.fromEntries(TRAINING_RESTRICTION_SOURCES.slice(1).map(kind=>[kind,async()=>({
  ownerId:owner,snapshotVersion:version,exhaustive:true,nextCursor:null,
  evidenceRef:'trusted:'+kind,records:[],
 })]));
 const r=createTrainingRestrictionSourceReaderCandidate({
  pool:{connect:async()=>db},authClient:{auth:{getUser:async()=>({data:{user:{id:owner}}})}},
  sourceReaders:readers,reconcileSource:async()=>({reconciledCount:0,unresolvedCount:0}),
 });
 await assert.rejects(r.ingestReviewedSources({bearerToken:signedFixtureToken,snapshotVersion:version}),
  /Unapproved Training ingestion receipt/);
 assert.equal(released,true);
});

test('canonical current-source query includes retired rows and rejects truncation',async()=>{
 const queries=[];
 const records=[{id:'one',user_id:owner,status:'active'},
  {id:'two',user_id:owner,status:'retired'}];
 const client={query:async(sql,args)=>{
  queries.push({sql,args});
  return {rows:records};
 }};
 const result=await readCanonicalCurrentRestrictionSource({
  client,ownerId:owner,snapshotVersion:version,
 });
 assert.equal(result.exhaustive,true);
 assert.equal(result.records.length,2);
 assert.equal(result.records[1].status,'retired');
 assert.match(queries[0].sql,/WHERE user_id=\$1 ORDER BY id LIMIT 201/);
 assert.deepEqual(queries[0].args,[owner]);
 await assert.rejects(readCanonicalCurrentRestrictionSource({
  client:{query:async()=>({rows:Array.from({length:201},()=>({user_id:owner}))})},
  ownerId:owner,snapshotVersion:version,
 }),/unbounded/);
 await assert.rejects(readCanonicalCurrentRestrictionSource({
  client:{query:async()=>({rows:[{user_id:other}]})},
  ownerId:owner,snapshotVersion:version,
 }),/foreign/);
});

test('revoked Auth token and supplied current-reader override are rejected',async()=>{
 const readers=Object.fromEntries(TRAINING_RESTRICTION_SOURCES.slice(1)
  .map(kind=>[kind,async()=>({})]));
 assert.throws(()=>createTrainingRestrictionSourceReaderCandidate({
  pool:{connect:async()=>{throw Error('unreachable');}},
  authClient:{auth:{getUser:async()=>({data:{user:{id:owner}}})}},
  sourceReaders:{...readers,current_restrictions:async()=>({})},
  reconcileSource:async()=>({reconciledCount:0,unresolvedCount:0}),
 }),/All trusted Training source readers/);
 let connected=false;
 const reader=createTrainingRestrictionSourceReaderCandidate({
  pool:{connect:async()=>{connected=true;throw Error('unreachable');}},
  authClient:{auth:{getUser:async()=>({error:Error('revoked')})}},
  sourceReaders:readers,
  reconcileSource:async()=>({reconciledCount:0,unresolvedCount:0}),
 });
 await assert.rejects(reader.ingestReviewedSources({
  bearerToken:signedFixtureToken,snapshotVersion:version,
 }),/Verified Training Auth owner/);
 assert.equal(connected,false);
});
