import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalPgAccountReaderCandidate} from './trainingExportCanonicalPgReader.mjs';
const owner='91111111-9111-4111-8111-911111111111';
const other='92222222-9222-4222-8222-922222222222';
const sessionId='93333333-9333-4333-8333-933333333333';
const requestId='95555555-9555-4555-8555-955555555555';
function fixture({failPage=false,complete=false}={}){
 const calls=[];let released=false;
 const client={
  async query(sql,args){
   calls.push({sql,args});
   if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
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
 assert.equal(f.calls.length,2);
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
