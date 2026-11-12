import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalPgAccountReaderCandidate} from './trainingExportCanonicalPgReader.mjs';
import {auditOwnerPrivateMediaCoverage} from './trainingExportSupabaseStorage.mjs';
const owner='91111111-9111-4111-8111-911111111111';
const other='92222222-9222-4222-8222-922222222222';
const sessionId='93333333-9333-4333-8333-933333333333';
const requestId='95555555-9555-4555-8555-955555555555';
function fixture({failPage=false,complete=false}={}){
 const calls=[];let released=false;
 const client={
  async query(sql,args){
   calls.push({sql,args});
   if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL')
     ||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.includes('inventory_review_candidate'))
    return {rows:[{payload:{ownerId:owner,requestId,complete,
      snapshotId:sessionId,collections:['public.v2_coach_messages']}}]};
   if(sql.includes('page_review_candidate')){
    if(failPage)throw Error('Snapshot was revoked');
    return {rows:[{payload:{ownerId:owner,requestId,collection:args[3],
     ownerVerified:true,snapshotId:sessionId,rows:[{user_id:owner}],done:true,nextCursor:null}}]};
   }
   throw Error('Unexpected arbitrary SQL');
  },
  release(){released=true;},
 };
 const pool={connect:async()=>client};
 return {pool,calls,get released(){return released;}};
}
test('pinned transaction validates inventory/pages and commits once',async()=>{
 const f=fixture();
 const reader=createCanonicalPgAccountReaderCandidate({pool:f.pool});
 const result=await reader.withRepeatableReadSnapshot({ownerId:owner,sessionId,requestId},async scoped=>{
  const inv=await scoped.getCanonicalInventory({ownerId:owner,requestId});
  const page=await scoped.readPage({ownerId:owner,requestId,
   collection:'public.v2_coach_messages',cursor:null,limit:200});
  assert.equal(page.ownerVerified,true);
  assert.equal(inv.complete,false);
  return page;
 });
 assert.equal(result.rows[0].user_id,owner);
 assert.equal(f.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(f.calls.at(-1).sql,'COMMIT');
 assert.equal(f.calls.some(x=>x.sql==='ROLLBACK'),false);
 for(const setting of ['statement_timeout','lock_timeout','idle_in_transaction_session_timeout'])
   assert(f.calls.some(x=>x.sql.startsWith('SET LOCAL '+setting)),
     'Missing bounded private export DB resource guard: '+setting);
 assert.equal(f.calls.find(x=>x.sql.includes('page_review_candidate')).args.at(-1),25);
 assert.equal(f.released,true);
});
test('foreign account/request, unreviewed table and injection blocked before database query',async()=>{
 const f=fixture();
 const reader=createCanonicalPgAccountReaderCandidate({pool:f.pool});
 await reader.withRepeatableReadSnapshot({ownerId:owner,sessionId,requestId},async scoped=>{
  await assert.rejects(scoped.readPage({ownerId:other,requestId,
    collection:'public.v2_coach_messages',cursor:null,limit:25}),/Invalid/);
  await assert.rejects(scoped.getCanonicalInventory({ownerId:owner,requestId:other}),/mismatch/);
  await assert.rejects(scoped.readPage({ownerId:owner,requestId,
    collection:'public.v2_messages; DROP TABLE auth.users',cursor:null,limit:25}),/Invalid/);
 });
 assert.equal(f.calls.length,5);
 assert.equal(f.released,true);
});
test('page failure rolls back and never leaves snapshot open',async()=>{
 const f=fixture({failPage:true});
 const reader=createCanonicalPgAccountReaderCandidate({pool:f.pool});
 await assert.rejects(reader.withRepeatableReadSnapshot({ownerId:owner,sessionId,requestId},async scoped=>{
  await scoped.readPage({ownerId:owner,requestId,collection:'public.v2_coach_messages',cursor:null,limit:10});
 }),/revoked/);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 assert.equal(f.released,true);
});
test('scoped capability cannot read after the database snapshot transaction closes',async()=>{
 const f=fixture();
 let capture;
 await createCanonicalPgAccountReaderCandidate({pool:f.pool})
  .withRepeatableReadSnapshot({ownerId:owner,sessionId,requestId},async scoped=>{capture=scoped;});
 await assert.rejects(capture.getCanonicalInventory({ownerId:owner,requestId}),/closed/);
 assert.equal(f.released,true);
});
test('missing trusted DB pool and invalid Auth session rejected',async()=>{
 assert.throws(()=>createCanonicalPgAccountReaderCandidate({pool:null}),/pool/);
 const f=fixture();
 await assert.rejects(createCanonicalPgAccountReaderCandidate({pool:f.pool})
  .withRepeatableReadSnapshot({ownerId:owner,sessionId:'not-a-session',requestId},async()=>{}),/Verified/);
 assert.equal(f.calls.length,0);
});

test('private media and Storage catalog are read through the same pinned snapshot',async()=>{
 const calls=[];
 const client={
  async query(sql,args){
   calls.push({sql,args});
   if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL')||['COMMIT','ROLLBACK'].includes(sql))
    return {rows:[]};
   if(sql.includes('FROM storage.buckets'))return {rows:[
    {id:'v2-private-workout-objects',public:false},
    {id:'v2-private-account-exports',public:false},
   ]};
   if(sql.includes('FROM storage.objects'))return {rows:[{
    name:owner+'/a'.repeat(64)+'/series.fit',
   }]};
   if(sql.includes('FROM public.v2_activity_series'))return {rows:[
    {kind:'series',user_id:owner,object_path:owner+'/a'.repeat(64)+'/series.fit',
     checksum_sha256:'b'.repeat(64)},
   ]};
   throw Error('Unapproved media SQL');
  },
  release(){},
 };
 const reader=createCanonicalPgAccountReaderCandidate({pool:{connect:async()=>client}});
 let after;
 await reader.withRepeatableReadSnapshot({ownerId:owner,sessionId,requestId},async scoped=>{
  after=scoped;
  const buckets=await scoped.listBucketCatalog({ownerId:owner,requestId});
  assert.equal(buckets.length,2);
  const objects=await scoped.listOwnerStorageObjects({
    ownerId:owner,requestId,bucketId:'v2-private-workout-objects',
  });
  const refs=await scoped.listCanonicalMediaReferences({ownerId:owner,requestId});
  assert.equal(objects.totalCount,1);
  assert.equal(objects.paths[0],refs.series[0].object_path);
  assert.equal(refs.routes.length,0);
  const audit=await auditOwnerPrivateMediaCoverage({
    ownerId:owner,requestId,
    listBucketCatalog:scoped.listBucketCatalog,
    listOwnerStorageObjects:scoped.listOwnerStorageObjects,
    listCanonicalMediaReferences:scoped.listCanonicalMediaReferences,
  });
  assert.equal(audit.referencesReconciled,true);
  assert.equal(audit.referencedObjects,1);
  assert.equal(audit.completeUserExport,false);
  await assert.rejects(scoped.listOwnerStorageObjects({
    ownerId:other,requestId,bucketId:'v2-private-workout-objects',
  }),/Unreviewed/);
  await assert.rejects(scoped.listOwnerStorageObjects({
    ownerId:owner,requestId,bucketId:'v2-progress-photos',
  }),/Unreviewed/);
 });
 assert.equal(calls.filter(x=>x.sql.startsWith('BEGIN')).length,1);
 assert.equal(calls.filter(x=>x.sql==='COMMIT').length,1);
 assert(calls.some(x=>x.sql.includes('FROM storage.objects')
   &&x.args[1]===owner+'/%'));
 await assert.rejects(after.listBucketCatalog({ownerId:owner,requestId}),/closed/);
});
test('owner media scan refuses more than the approved 128 objects',async()=>{
 const client={
  async query(sql){
   if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL')||['COMMIT','ROLLBACK'].includes(sql))
    return {rows:[]};
   if(sql.includes('FROM storage.objects'))return {rows:Array.from({length:129},(_,i)=>({
    name:owner+'/'+i,
   }))};
   throw Error('Unexpected query');
  },release(){},
 };
 const reader=createCanonicalPgAccountReaderCandidate({pool:{connect:async()=>client}});
 await assert.rejects(reader.withRepeatableReadSnapshot({
  ownerId:owner,sessionId,requestId,
 },async scoped=>scoped.listOwnerStorageObjects({
  ownerId:owner,requestId,bucketId:'v2-private-workout-objects',
 })),/exceeds review bound/);
});
