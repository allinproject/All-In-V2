import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createTrainingAccountExportWorkerCandidate} from './v2-training-account-export-worker-candidate.mjs';
import {decryptTrainingExportForVerification} from './v2-training-encrypted-export-envelope.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const session='22222222-2222-4222-8222-222222222222';
const requestId='33333333-3333-4333-8333-333333333333';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const path=owner+'/'+'c'.repeat(64)+'/sensor.fit';
const bytes=Buffer.from('simulated owner-only training evidence');
const digest=createHash('sha256').update(bytes).digest('hex');
const token=['eyJhbGciOiJIUzI1NiJ9',
 Buffer.from(JSON.stringify({sub:owner,session_id:session})).toString('base64url'),
 'test-signature'].join('.');
const row=()=>({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 user_id:owner,activity_id:activity,source_id:source,
 object_path:path,checksum_sha256:digest,state:'ready',
 quality:'unverified',encoding:'fit',sample_count:42,
 starts_at:'2026-11-11T12:00:00Z',ends_at:'2026-11-11T12:01:00Z'});
function setup(options={}) {
 const events=[];
 const key=randomBytes(32);
 let envelope=null;
 const pagedArchives=new Map();
 const authClient={auth:{getUser:async (supplied)=>{
   assert.equal(supplied,token);
   events.push('auth');
   if(options.revokeAfterWrite&&events.filter(x=>x==='auth').length>=3)
     return {error:new Error('revoked')};
   if(options.revokeAfterSnapshot&&events.includes('snapshotClosed'))
     return {error:new Error('revoked after staging')};
   return {data:{user:{id:owner}}};
 }}};
 const data={v2_activity_series:[row()],v2_activity_route_objects:[]};
 const serviceClient={
  rpc:async (name,args)=>{
   assert.equal(name,'v2_account_export_worker_authorize_candidate');
   assert.deepEqual(args,{p_user_id:owner,p_session_id:session,p_request_id:requestId});
   events.push('approvedRequest');
   return options.denyRequest?{error:new Error('cancelled')}:
     {data:{ownerId:owner,sessionId:session,requestId,
       status:'approved',cancelled:false,
       expiresAt:new Date(Date.now()+3600000).toISOString()}};
  },
  from(table){
   return {select:()=> {
     const filters=[];
     const query={
       eq(name,value){filters.push([name,value]);return query;},
       order(){return query;},
       async range(){
         events.push('list');
         return {data:data[table],count:data[table].length,error:null};
       },
       async maybeSingle(){
         events.push('ownerPathProof');
         const matches=(data[table]??[]).filter(x=>
           filters.every(([name,value])=>x[name]===value));
         return {data:matches.length===1?matches[0]:null,error:null};
       },
     };return query;
   }};
  },
  storage:{
   async listBuckets(){
     return {data:[{id:'v2-private-workout-objects',public:options.publicBucket??false},
       {id:'v2-private-account-exports',public:false}],error:null};
   },
   async getBucket(name){
     events.push('bucket');
     return {data:{id:name,public:options.publicBucket??false},error:null};
   },
   from(name){
     assert(['v2-private-workout-objects','v2-private-account-exports'].includes(name));
     return {
       async download(objectPath){
         if(name==='v2-private-account-exports'){
           events.push('pagedDownload');
           return pagedArchives.has(objectPath)?
             {data:new Blob([pagedArchives.get(objectPath)]),error:null}:
             {data:null,error:Error('missing')};
         }
         assert.equal(name,'v2-private-workout-objects');
         assert.equal(objectPath,path);
         events.push('download');
         return {data:new Blob([options.corrupt?Buffer.from('wrong'):bytes]),error:null};
       },
       async upload(objectPath,blob,opts){
         assert.equal(name,'v2-private-account-exports');
         assert.equal(opts.upsert,false);
         events.push('archiveUpload');
         const raw=await blob.text();
         envelope=JSON.parse(raw);
         pagedArchives.set(objectPath,raw);
         return {data:{path:objectPath},error:null};
       },
       async list(prefix,{limit=1000,offset=0}={}){
         if(name==='v2-private-workout-objects' && options.mediaAudit){
           if(prefix===owner) return {data:[{name:'c'.repeat(64),id:null}],error:null};
           if(prefix===owner+'/'+'c'.repeat(64)){
             const files=[{name:'sensor.fit',id:'file',metadata:{size:bytes.byteLength}}];
             if(options.mediaExtra)files.push({name:'unknown.jpg',id:'other',metadata:{size:5}});
             return {data:files,error:null};
           }
           return {data:[],error:null};
         }
         const names=[...pagedArchives.keys()].filter(k=>k.startsWith(prefix+'/'))
           .slice(offset,offset+limit).map(k=>({name:k.slice(prefix.length+1)}));
         return {data:names,error:null};
       },
       async remove(paths){
         assert.equal(name,'v2-private-account-exports');
         events.push('archiveRemove');
         purges++;
         for(const p of paths)pagedArchives.delete(p);
         return {data:paths.map(name=>({name})),error:null};
       },
     };
   },
  },
 };
 let purges=0;
 const defaultPersistence={
   persistPrivateEnvelope:async payload=>{
     events.push('archiveWrite');
     envelope=payload.envelope;
     return {ownerId:owner,requestId,archiveId:'internal-archive',
       encrypted:true,private:true,
       expiresAt:new Date(Date.now()+3600000).toISOString()};
   },
   deletePrivateRequest:async ({ownerId,requestId:request})=>{
     assert.equal(ownerId,owner);assert.equal(request,requestId);
     events.push('purge');purges++;return true;
   },
 };
 const selectedPersistence=options.useSupabasePersistence
  ?{readApprovedRequestExpiry:async ({ownerId,requestId:rid})=>{
      assert.equal(ownerId,owner);assert.equal(rid,requestId);
      return {ownerId:owner,requestId,status:'approved',cancelled:false,
        expiresAt:new Date(Date.now()+3600000).toISOString()};
    }}
  :defaultPersistence;
 const pinnedPageReader=options.pinnedReader?{
   withRepeatableReadSnapshot:async({ownerId,sessionId,requestId:rid},fn)=>{
    assert.equal(ownerId,owner);assert.equal(sessionId,session);assert.equal(rid,requestId);
    events.push('snapshotOpen');
    try {
     const receipt=await fn({
      getCanonicalInventory:async({ownerId:o,requestId:r})=>({
       ownerId:o,requestId:r,snapshotId:requestId,
       complete:!options.unapprovedDomain,collections:['coach_messages'],
      }),
      readPage:async({ownerId:o,collection})=>({
       ownerId:o,collection,snapshotId:requestId,ownerVerified:true,
       rows:[{id:'pinned-owner-history',user_id:owner,content:'Only A private history'}],
       done:true,nextCursor:null,
      }),
     });
     if(options.snapshotCommitFails)throw Error('pinned DB COMMIT failed');
     return receipt;
    } finally {events.push('snapshotClosed');}
   },
 }:undefined;
 const canonicalPageReader=options.largeReader?{
   getCanonicalInventory:async({ownerId,requestId:rid})=>({
     ownerId,requestId:rid,snapshotId:requestId,complete:true,
     collections:['coach_messages'],
   }),
   readPage:async({ownerId,collection})=>({
     ownerId,collection,snapshotId:requestId,ownerVerified:true,
     rows:[{id:'private-record',user_id:owner,content:'Coach owner history'}],
     done:true,nextCursor:null,
   }),
 }:undefined;
 const worker=createTrainingAccountExportWorkerCandidate({
   bearerToken:token,authClient,serviceClient,
   resolveEncryptionKey:async()=>key,...selectedPersistence,
   canonicalPageReader:pinnedPageReader??canonicalPageReader,
 });
 return {worker,events,key,pagedArchives,get envelope(){return envelope;},
   get purges(){return purges;}};
}
test('end-to-end disabled worker binds live owner request and encrypts checked Storage bytes',async()=>{
 const f=setup();
 const result=await f.worker.stageApprovedRequest(requestId);
 assert.equal(result.archiveId,'internal-archive');
 assert.equal(result.archiveStaged,true);
 assert.equal(result.completeUserExport,false);
 assert.equal(result.storageAuthorizationVerified,false);
 assert.equal(result.verifiedFileCount,1);
 assert.equal(f.events.filter(x=>x==='auth').length,3);
 assert.equal(f.events.filter(x=>x==='approvedRequest').length,3);
 assert.equal(f.events.filter(x=>x==='ownerPathProof').length,1);
 assert.equal(f.events.filter(x=>x==='archiveWrite').length,1);
 assert.equal(f.purges,0);
 assert.equal(JSON.stringify(result).includes(bytes.toString()),false);
 const unsealed=decryptTrainingExportForVerification(f.envelope,f.key,owner,requestId);
 assert.equal(Buffer.from(unsealed.files[0].bytes,'base64').toString(),bytes.toString());
});
test('missing approved owner request aborts before any Storage access',async()=>{
 const f=setup({denyRequest:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/approved export request/);
 assert.equal(f.events.some(x=>x==='download'),false);
 assert.equal(f.events.some(x=>x==='archiveWrite'),false);
});
test('public bucket aborts before downloads',async()=>{
 const f=setup({publicBucket:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/public/);
 assert.equal(f.events.some(x=>x==='download'),false);
});
test('tampered private file aborts without archive creation',async()=>{
 const f=setup({corrupt:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/checksum/);
 assert.equal(f.events.some(x=>x==='archiveWrite'),false);
});
test('revoked session after durable archive write invokes cleanup, no success',async()=>{
 const f=setup({revokeAfterWrite:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/unavailable/);
 assert.equal(f.events.filter(x=>x==='archiveWrite').length,1);
 assert.equal(f.purges,1);
});

test('complete service-only Supabase archive path persists encrypted envelope and owner receipt',async()=>{
 const f=setup({useSupabasePersistence:true});
 const result=await f.worker.stageApprovedRequest(requestId);
 assert.equal(result.archiveStaged,true);
 assert.equal(result.archiveId,owner+'/'+requestId+'/archive.aesgcm.json');
 assert.equal(result.completeUserExport,false);
 assert.equal(f.events.filter(x=>x==='archiveUpload').length,1);
 const clear=decryptTrainingExportForVerification(f.envelope,f.key,owner,requestId);
 assert.equal(Buffer.from(clear.files[0].bytes,'base64').toString(),bytes.toString());
});
test('Supabase archive is removed via Storage API when session revoked after write',async()=>{
 const f=setup({useSupabasePersistence:true,revokeAfterWrite:true});
 await assert.rejects(f.worker.stageApprovedRequest(requestId),/unavailable/);
 assert.equal(f.events.filter(x=>x==='archiveUpload').length,1);
 assert.equal(f.events.filter(x=>x==='archiveRemove').length,1);
 assert.equal(f.purges,1);
});

test('large history is staged and downloaded by existing trusted account worker, no URL',async()=>{
 const f=setup({useSupabasePersistence:true,largeReader:true});
 const result=await f.worker.stageApprovedLargeHistory(requestId);
 assert.equal(result.completeUserExport,true);
 assert.equal(result.downloadAuthorized,false);
 assert.equal(result.encrypted,true);
 assert.equal(f.pagedArchives.size,2);
 const response=await f.worker.openApprovedLargeHistoryDownload(requestId);
 assert.equal(response.status,200);
 const body=await response.text();
 assert(body.includes('Coach owner history'));
 assert.equal(response.headers.has('access-control-allow-origin'),false);
 assert.equal(JSON.stringify(result).includes('Coach owner history'),false);
});
test('large history stays unavailable until exact canonical reader and request lease are configured',async()=>{
 const f=setup();
 await assert.rejects(f.worker.stageApprovedLargeHistory(requestId),/not configured/);
 await assert.rejects(f.worker.openApprovedLargeHistoryDownload(requestId),/not configured/);
 assert.equal(f.events.some(x=>x==='pagedDownload'),false);
});

test('canonical worker holds one PostgreSQL snapshot across staged pages and downloads frozen private manifest',async()=>{
 const f=setup({useSupabasePersistence:true,pinnedReader:true});
 const staged=await f.worker.stageApprovedLargeHistory(requestId);
 assert.equal(staged.completeUserExport,true);
 assert.equal(f.events.filter(x=>x==='snapshotOpen').length,1);
 assert.equal(f.events.filter(x=>x==='snapshotClosed').length,1);
 const response=await f.worker.openApprovedLargeHistoryDownload(requestId);
 assert.equal(response.status,200);
 const result=await response.text();
 assert(result.includes('Only A private history'));
 assert.equal(f.events.filter(x=>x==='snapshotOpen').length,1,
  'frozen staging receipt must not run new mutable DB snapshot during download');
});
test('unreviewed Community or Storage source blocks worker before any archived page',async()=>{
 const f=setup({useSupabasePersistence:true,pinnedReader:true,unapprovedDomain:true});
 await assert.rejects(f.worker.stageApprovedLargeHistory(requestId),/coverage or privacy review incomplete/);
 assert.equal(f.pagedArchives.size,0);
 assert.deepEqual(f.events.filter(x=>x.startsWith('snapshot')),['snapshotOpen','snapshotClosed']);
});

test('database COMMIT failure after encrypted manifest staging purges the private archive',async()=>{
 const f=setup({useSupabasePersistence:true,pinnedReader:true,snapshotCommitFails:true});
 await assert.rejects(f.worker.stageApprovedLargeHistory(requestId),/COMMIT failed/);
 assert.equal(f.pagedArchives.size,0);
 assert.equal(f.events.filter(x=>x==='archiveRemove').length,1);
 assert.equal(f.events.filter(x=>x==='snapshotClosed').length,1);
});
test('session revoked immediately after snapshot commit purges completed private pages',async()=>{
 const f=setup({useSupabasePersistence:true,pinnedReader:true,revokeAfterSnapshot:true});
 await assert.rejects(f.worker.stageApprovedLargeHistory(requestId),/unavailable/);
 assert.equal(f.pagedArchives.size,0);
 assert.equal(f.events.filter(x=>x==='archiveRemove').length,1);
});

test('existing ALL-251 worker audits canonical private evidence without claiming complete export',async()=>{
 const f=setup({useSupabasePersistence:true,mediaAudit:true});
 const result=await f.worker.auditApprovedPrivateMediaCoverage(requestId);
 assert.equal(result.verifiedObjects,1);
 assert.equal(result.checksumVerified,true);
 assert.equal(result.completeUserExport,false);
 assert(f.events.includes('ownerPathProof'));
 assert(f.events.includes('download'));
 assert(f.events.filter(x=>x==='auth').length>=2);
});
test('existing worker refuses extra private media with no canonical Training reference',async()=>{
 const f=setup({useSupabasePersistence:true,mediaAudit:true,mediaExtra:true});
 await assert.rejects(f.worker.auditApprovedPrivateMediaCoverage(requestId),/do not match/);
});
test('media audit never runs from an unleased legacy export worker',async()=>{
 const f=setup();
 await assert.rejects(f.worker.auditApprovedPrivateMediaCoverage(requestId),/approved request lease/);
 assert.equal(f.events.includes('download'),false);
});
