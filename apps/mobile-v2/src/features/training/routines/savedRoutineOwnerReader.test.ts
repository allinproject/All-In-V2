import test from 'node:test';
import assert from 'node:assert/strict';
import {
 readAuthenticatedSavedRoutineList,readAuthenticatedSavedRoutineVersion,
 type SavedRoutineReadServices,type SavedRoutineListPage,
} from './savedRoutineOwnerReader.ts';
import type {SavedRoutineOwnerSnapshot} from './routineWorkoutReview.ts';

const owner='athlete-a',other='athlete-b',sessionGeneration=4;
const summary={routineId:'routine-1',ownerId:owner,version:2,
 name:'Workout A',sport:'strength' as const,updatedAt:'2026-11-13T20:00:00Z',isFavorite:false};
const detail:SavedRoutineOwnerSnapshot={
 identity:'canonical_saved_routine',routineId:'routine-1',ownerId:owner,
 version:2,sessionGeneration,complete:true,name:'Workout A',sport:'strength',notes:'',
 blocks:[{kind:'strength',id:'exercise-1',exercise:'Squat',equipment:null,notes:'',
  sets:3,reps:'5',weight:null,restSeconds:90,setType:'working',groupId:null}],
};
const make=(page:SavedRoutineListPage,record:SavedRoutineOwnerSnapshot|null=detail):SavedRoutineReadServices=>({
 authenticateOwner:async(id,generation)=>{assert.equal(id,owner);assert.equal(generation,sessionGeneration);},
 readListPage:async()=>page,
 readVersion:async()=>record,
});
const complete:SavedRoutineListPage={
 expectedOwnerId:owner,sessionGeneration,snapshotVersion:'snapshot-1',
 records:[summary],hasMore:false,nextCursor:null,
};
test('empty owner-owned list is ready only with an attested complete page',async()=>{
 const result=await readAuthenticatedSavedRoutineList(owner,sessionGeneration,
  make({...complete,records:[]}));
 assert.equal(result.status,'ready');
 if(result.status==='ready')assert.deepEqual(result.records,[]);
});
test('cross-owner list cannot be displayed even when backend returns a record',async()=>{
 const result=await readAuthenticatedSavedRoutineList(owner,sessionGeneration,
  make({...complete,records:[{...summary,ownerId:other}]}));
 assert.deepEqual(result,{status:'unavailable',records:[]});
});
test('list rejects wrong-owner/page generation and missing completion markers',async()=>{
 for(const page of [
  {...complete,expectedOwnerId:other},
  {...complete,sessionGeneration:sessionGeneration+1},
  {...complete,hasMore:true,nextCursor:null},
  {...complete,nextCursor:'unexpected'},
  {...complete,records:[summary,summary]},
 ]){
  const result=await readAuthenticatedSavedRoutineList(owner,sessionGeneration,make(page));
  assert.equal(result.status,'unavailable');
 }
});
test('paginates one stable snapshot and fails closed when snapshot changes',async()=>{
 const second={...summary,routineId:'routine-2'};
 let calls=0;
 const services:SavedRoutineReadServices={
  authenticateOwner:async()=>{},
  readVersion:async()=>detail,
  readListPage:async({cursor,limit})=>{
   assert.equal(limit,100);calls++;
   if(!cursor)return{...complete,records:[summary],hasMore:true,nextCursor:'next'};
   assert.equal(cursor,'next');
   return{...complete,records:[second]};
  },
 };
 const ok=await readAuthenticatedSavedRoutineList(owner,sessionGeneration,services);
 assert.equal(ok.status,'ready');
 if(ok.status==='ready')assert.deepEqual(ok.records.map(r=>r.routineId),['routine-1','routine-2']);
 assert.equal(calls,2);
 const changed=await readAuthenticatedSavedRoutineList(owner,sessionGeneration,{
  ...services,readListPage:async({cursor})=>cursor
    ?{...complete,snapshotVersion:'changed',records:[second]}:
     {...complete,hasMore:true,nextCursor:'next'},
 });
 assert.equal(changed.status,'unavailable');
});
test('account switch during a network read cannot display saved routines',async()=>{
 let active=true;
 const services=make(complete);
 const result=await readAuthenticatedSavedRoutineList(owner,sessionGeneration,{
  ...services,readListPage:async()=>{active=false;return complete;},
 },()=>active);
 assert.equal(result.status,'unavailable');
});
test('detail fetch rejects owner/version mismatch and partial structure',async()=>{
 const request={expectedOwnerId:owner,sessionGeneration,routineId:'routine-1',version:2};
 const good=await readAuthenticatedSavedRoutineVersion(request,make(complete));
 assert.equal(good.status,'ready');
 if(good.status==='ready')assert.notEqual(good.record,detail);
 for(const variant of [
  {...detail,ownerId:other},
  {...detail,version:3},
  {...detail,sessionGeneration:5},
  {...detail,complete:false} as unknown as SavedRoutineOwnerSnapshot,
  {...detail,blocks:[]},
 ]){
  const failed=await readAuthenticatedSavedRoutineVersion(request,make(complete,variant));
  assert.equal(failed.status,'unavailable');
 }
});
test('auth failure or lost session leaves reader unavailable, never empty-ready',async()=>{
 const denied:SavedRoutineReadServices={
  ...make(complete),authenticateOwner:async()=>{throw new Error('Session revoked');},
 };
 assert.equal((await readAuthenticatedSavedRoutineList(owner,sessionGeneration,denied)).status,'unavailable');
 const detailResult=await readAuthenticatedSavedRoutineVersion({
  expectedOwnerId:owner,sessionGeneration,routineId:'routine-1',version:2,
 },denied);
 assert.equal(detailResult.status,'unavailable');
});
