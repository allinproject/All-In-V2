import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditPrivateMediaExportCoverage,createSupabaseTrainingMediaAuditAdapters} from './trainingExportMediaCoverage.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const bucket='v2-private-workout-objects';
const path=owner+'/activities/private/series.verified';
const bytes=new TextEncoder().encode('owner-only GPS samples for account export');
const hash=createHash('sha256').update(bytes).digest('hex');
const record={kind:'series',user_id:owner,object_path:path,
 checksum_sha256:hash,state:'ready'};
function fixture(options={}){
 const calls=[];
 const services={
  ownerId:owner,requestId,
  listBuckets:async()=>options.buckets??[{id:bucket,public:false},
    {id:'v2-private-account-exports',public:false}],
  listCanonicalEvidence:async input=>{calls.push('canonical');
   return {ownerId:owner,sourceCoverageComplete:options.sourceComplete??true,
    records:options.records??[record]};},
  listOwnerStorageObjects:async input=>{calls.push('storage');
   return {ownerId:owner,bucket,complete:options.listComplete??true,
    objects:options.objects??[{path,size:bytes.byteLength}]};},
  readVerifiedObject:async input=>{calls.push('read');
   assert.equal(input.path,path);return options.bytes??bytes;},
 };
 return {services,calls};
}
test('exact owner storage bytes and canonical references verify, but do not unlock full account export',async()=>{
 const f=fixture();
 const result=await auditPrivateMediaExportCoverage(f.services);
 assert.equal(result.verifiedObjects,1);
 assert.equal(result.verifiedBytes,bytes.byteLength);
 assert.equal(result.exactPathCoverage,true);
 assert.equal(result.checksumVerified,true);
 assert.equal(result.completeUserExport,false);
 assert.deepEqual(f.calls,['canonical','storage','read']);
});
test('unexpected public or unknown media buckets fail before canonical reads',async()=>{
 for(const buckets of [
  [{id:bucket,public:true}],
  [{id:'v2-private-nutrition-photos',public:false}],
  [{id:bucket,public:false},{id:bucket,public:false}],
 ]){
  const f=fixture({buckets});
  await assert.rejects(auditPrivateMediaExportCoverage(f.services),/Unknown or public/);
  assert.equal(f.calls.length,0);
 }
});
test('extra, duplicate or missing Storage entries fail closed before byte reads',async()=>{
 for(const objects of [
  [],[{path,size:bytes.byteLength},{path:owner+'/unreviewed.jpg',size:12}],
  [{path,size:bytes.byteLength},{path,size:bytes.byteLength}],
  [{path:other+'/foreign.file',size:12}],
 ]){
  const f=fixture({objects});
  await assert.rejects(auditPrivateMediaExportCoverage(f.services),/private Storage|Private Storage|Invalid/);
  assert.equal(f.calls.includes('read'),false);
 }
});
test('unreviewed canonical media metadata or truncated list blocks the export',async()=>{
 const rows=[
  {records:[{...record,user_id:other}]},
  {records:[{...record,object_path:other+'/private.file'}]},
  {records:[{...record,checksum_sha256:'invalid'}]},
  {records:[{...record,kind:'route',privacy_state:'public'}]},
  {sourceComplete:false},
  {listComplete:false},
 ];
 for(const config of rows){
  const f=fixture(config);
  await assert.rejects(auditPrivateMediaExportCoverage(f.services),/Incomplete|Invalid/);
  assert.equal(f.calls.includes('read'),false);
 }
});
test('a single changed byte invalidates the canonical media checksum',async()=>{
 const changed=new Uint8Array(bytes);
 changed[0]^=1; // Preserve object length; exercise SHA rather than size guard.
 const f=fixture({bytes:changed});
 await assert.rejects(auditPrivateMediaExportCoverage(f.services),/SHA-256/);
});
test('missing Storage reference creates no false complete export result',async()=>{
 const f=fixture({records:[],objects:[]});
 const result=await auditPrivateMediaExportCoverage(f.services);
 assert.equal(result.completeUserExport,false);
 assert.equal(result.verifiedObjects,0);
});

test('composes existing Training evidence adapter with nested private Storage listings',async()=>{
 const traversed=[];
 const supabase={storage:{
  listBuckets:async()=>({data:[{id:bucket,public:false},{id:'v2-private-account-exports',public:false}],error:null}),
  from:()=>({list:async(prefix,opts)=>{
   traversed.push({prefix,offset:opts.offset});
   if(prefix===owner)return {data:[{name:'activities',id:null}],error:null};
   if(prefix===owner+'/activities')return {data:[{name:'private',id:null}],error:null};
   if(prefix===owner+'/activities/private')
    return {data:[{name:'series.verified',id:'file-id',metadata:{size:bytes.byteLength}}],error:null};
   throw Error('Unexpected owner Storage prefix');
  }}),
 }};
 const evidenceAdapter={
  listEvidence:async()=>({ownerId:owner,series:[record],routes:[]}),
  downloadPrivateObject:async params=>{
   assert.equal(params.ownerId,owner);
   assert.equal(params.path,path);
   return bytes;
  },
 };
 const adapters=createSupabaseTrainingMediaAuditAdapters({supabase,evidenceAdapter});
 const result=await auditPrivateMediaExportCoverage({ownerId:owner,requestId,...adapters});
 assert.equal(result.exactPathCoverage,true);
 assert.equal(result.verifiedObjects,1);
 assert.equal(result.completeUserExport,false);
 assert(traversed.some(x=>x.prefix===owner+'/activities/private'));
});
test('recursive owner listing refuses unknown extra private files',async()=>{
 const supabase={storage:{
  listBuckets:async()=>({data:[{id:bucket,public:false}],error:null}),
  from:()=>({list:async prefix=>{
   if(prefix===owner)return {data:[{name:'private',id:null}],error:null};
   return {data:[{name:'unknown.jpg',id:'id',metadata:{size:12}}],error:null};
  }}),
 }};
 const adapters=createSupabaseTrainingMediaAuditAdapters({supabase,evidenceAdapter:{
  listEvidence:async()=>({ownerId:owner,series:[],routes:[]}),
  downloadPrivateObject:async()=>{throw Error('must not read unreviewed media');},
 }});
 await assert.rejects(auditPrivateMediaExportCoverage({ownerId:owner,requestId,...adapters}),/do not match/);
});
test('truncated or untrusted nested owner listing is never complete',async()=>{
 const supabase={storage:{
  listBuckets:async()=>({data:[{id:bucket,public:false}],error:null}),
  from:()=>({list:async()=>({data:Array.from({length:101},(_,i)=>({
   name:'unreviewed-'+i,id:'file',metadata:{size:1}
  })),error:null})}),
 }};
 const adapters=createSupabaseTrainingMediaAuditAdapters({supabase,evidenceAdapter:{
  listEvidence:async()=>({ownerId:owner,series:[],routes:[]}),
  downloadPrivateObject:async()=>{throw Error('must not read');},
 }});
 await assert.rejects(auditPrivateMediaExportCoverage({ownerId:owner,requestId,...adapters}),/Unbounded/);
});

test('Storage listing byte count must match the actual authenticated file length',async()=>{
 const f=fixture({objects:[{path,size:bytes.byteLength+1}]});
 await assert.rejects(auditPrivateMediaExportCoverage(f.services),/byte length differs/);
});
