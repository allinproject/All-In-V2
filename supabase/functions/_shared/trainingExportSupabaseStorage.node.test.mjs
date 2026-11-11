import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTrainingSupabaseEvidenceAdapter, TRAINING_PRIVATE_EVIDENCE_BUCKET } from './trainingExportSupabaseStorage.mjs';
import { stageTrainingPrivateStorageExport } from '../../../scripts/v2-training-private-storage-stage.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bytes = Buffer.from('actual private workout bytes');
const path = owner + '/' + 'a'.repeat(64) + '/series.fit';
const hash = createHash('sha256').update(bytes).digest('hex');
const seriesRow = () => ({
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: owner,
  activity_id: activityId, source_id: sourceId, object_path: path,
  checksum_sha256: hash, state: 'ready', quality: 'unverified',
  encoding: 'fit', sample_count: 13, starts_at: '2026-11-11T12:00:00Z',
  ends_at: '2026-11-11T12:02:00Z',
});
function fixture(options={}) {
  const calls=[];
  const data = options.tables ?? {
    v2_activity_series:[seriesRow()],v2_activity_route_objects:[],
  };
  const supabase = {
    from(table) {
      calls.push(['table',table]);
      return {
        select(cols,opts) {
          calls.push(['select',table,cols,opts]);
          const filters = [];
          const query = {
            eq(column,id) {
              calls.push(['eq',column,id]);
              filters.push([column,id]);
              return query;
            },
            order(column,{ascending}) {
              calls.push(['order',column,ascending]);
              return query;
            },
            async range(from,to) {
              calls.push(['range',from,to]);
              return options.queryFailure ? {error:new Error('query failed')} :
                {data:data[table]??[],count:options.reportedCount?.[table]??(data[table]??[]).length,error:null};
            },
            async maybeSingle() {
              calls.push(['single',table]);
              const matches=(data[table]??[]).filter(row=>
                filters.every(([field,value])=>row[field]===value));
              return options.queryFailure ? {data:null,error:new Error('query failed')} :
                {data:matches.length===1?matches[0]:null,
                 error:matches.length>1?new Error('multiple rows'):null};
            },
          };
          return query;
        },
      };
    },
    storage:{
      async getBucket(name) {
        calls.push(['bucket',name]);
        return {data:{id:name,public:options.bucketPublic??false},error:null};
      },
      from(bucket) {
        calls.push(['fromBucket',bucket]);
        return {
          async download(objectPath) {
            calls.push(['download',objectPath]);
            if (options.downloadFailure) return {data:null,error:new Error('missing')};
            return {data:new Blob([options.modifiedBytes??bytes]),error:null};
          },
        };
      },
    },
  };
  return {supabase,calls};
}
test('queries only source owner in exact tables and downloads a fixed private bucket',async()=>{
  const f=fixture();
  const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
  const snapshot=await adapter.listEvidence(owner,requestId);
  assert.equal(snapshot.ownerId,owner);
  assert.equal(snapshot.series.length,1);
  assert.equal(snapshot.routes.length,0);
  const got=await adapter.downloadPrivateObject({ownerId:owner,requestId,path,kind:'series'});
  assert.deepEqual(Buffer.from(got),bytes);
  assert.equal(f.calls.find(x=>x[0]==='fromBucket')[1],TRAINING_PRIVATE_EVIDENCE_BUCKET);
  const filters=f.calls.filter(x=>x[0]==='eq');
  assert.equal(filters.filter(x=>x[1]==='user_id'&&x[2]===owner).length,3);
  assert.equal(filters.filter(x=>x[1]==='object_path'&&x[2]===path).length,1);
  assert.equal(filters.length,4);
  const selects=f.calls.filter(x=>x[0]==='select');
  assert.equal(selects[0][1],'v2_activity_series');
  assert.equal(selects[1][1],'v2_activity_route_objects');
  assert.equal(selects[0][3].count,'exact');
  assert.equal(selects[1][3].count,'exact');
  assert(!selects[0][2].includes('privacy_state'));
  assert(!selects[1][2].includes('encoding'));
});
test('integrates with existing export staging; no client bytes or signed URL',async()=>{
  const f=fixture();
  const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
  const out=await stageTrainingPrivateStorageExport({
    requestId,services:{
      authorizeExport:async()=>({ownerId:owner,activeSession:true,exportPermitted:true}),
      ...adapter,
    },
  });
  assert.equal(out.verifiedFileCount,1);
  assert.equal(out.completeUserExport,false);
  assert.equal(out.storageAuthorizationVerified,false);
  assert(!JSON.stringify(out).includes(bytes.toString()));
});
test('public bucket and query failures are rejected before any private file download',async()=>{
  for(const config of [{bucketPublic:true},{queryFailure:true},
    {reportedCount:{v2_activity_series:2}}]) {
    const f=fixture(config);
    const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
    await assert.rejects(adapter.listEvidence(owner,requestId),/public|truncated|missing/);
    assert.equal(f.calls.some(x=>x[0]==='download'),false);
  }
});
test('foreign owner, pending evidence and duplicate object paths are rejected',async()=>{
  for(const series of [[{...seriesRow(),user_id:foreign}],
    [{...seriesRow(),state:'pending'}],
    [seriesRow(),{...seriesRow(),id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}]]) {
    const f=fixture({tables:{v2_activity_series:series,v2_activity_route_objects:[]}});
    const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
    await assert.rejects(adapter.listEvidence(owner,requestId),/Invalid|Duplicate/);
    assert(!f.calls.some(x=>x[0]==='download'));
  }
});
test('download request cannot select another owner, invalid path or alternate bucket',async()=>{
  const f=fixture();
  const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
  await assert.rejects(adapter.downloadPrivateObject({ownerId:owner,requestId,path:foreign+'/x',kind:'series'}),/Unsafe/);
  await assert.rejects(adapter.listEvidence('invalid',requestId),/owner/);
  await assert.rejects(adapter.downloadPrivateObject({ownerId:owner,requestId,path:owner+'/../'+path,kind:'series'}),/Unsafe/);
  assert.equal(f.calls.filter(x=>x[0]==='download').length,0);
});
test('corrupt Storage bytes fail existing SHA-256 evidence verification',async()=>{
  const f=fixture({modifiedBytes:Buffer.from('corrupted')});
  const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
  await assert.rejects(stageTrainingPrivateStorageExport({
    requestId,services:{
      authorizeExport:async()=>({ownerId:owner,activeSession:true,exportPermitted:true}),
      ...adapter,
    },
  }),/checksum/);
});

test('privileged download requires canonical current owner+path approval, not just owner prefix',async()=>{
  const f=fixture();
  const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
  await assert.rejects(adapter.downloadPrivateObject({
    ownerId:owner,requestId,kind:'series',path:owner+'/'+'z'.repeat(64)+'/unknown.fit',
  }),/not approved/);
  await assert.rejects(adapter.downloadPrivateObject({ownerId:owner,requestId,path,kind:'route'}),/not approved/);
  assert.equal(f.calls.filter(x=>x[0]==='download').length,0);
});
test('a previously listed file revoked in canonical database cannot be fetched',async()=>{
  const f=fixture({tables:{v2_activity_series:[{...seriesRow(),state:'revoked'}],v2_activity_route_objects:[]}});
  const adapter=createTrainingSupabaseEvidenceAdapter({supabase:f.supabase});
  await assert.rejects(adapter.downloadPrivateObject({ownerId:owner,requestId,path,kind:'series'}),/not approved/);
  assert.equal(f.calls.filter(x=>x[0]==='download').length,0);
});
