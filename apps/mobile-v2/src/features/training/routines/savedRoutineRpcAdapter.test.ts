import assert from 'node:assert/strict';
import test from 'node:test';
import {createStagedSavedRoutineReadServices,type OwnerAuthTransport} from './savedRoutineRpcAdapter.ts';
import {createStagedSavedRoutineMutationServices} from './savedRoutineRpcWriter.ts';
import {addRoutineBlock,newRoutineDraft,updateRoutineBlock} from './routineDraftEditor.ts';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const rid='aaa00000-0000-4000-8000-000000000001';
const action='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const make=()=>{
 let owner=a,active=true;
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const transport:OwnerAuthTransport={
  auth:{
   getUser:async()=>({data:{user:{id:owner}},error:null}),
   getSession:async()=>({data:{session:{user:{id:owner},expires_at:Math.ceil(Date.now()/1000)+900}},error:null}),
  },
  rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='v2_training_routine_list_owner_candidate')
    return{error:null,data:{expectedOwnerId:a,sessionGeneration:4,
     snapshotVersion:'routine-epoch:1',records:[],hasMore:false,nextCursor:null}};
   if(name==='v2_training_routine_read_owner_candidate')return{error:null,data:null};
   if(name==='v2_training_routine_save_owner_candidate')
    return{error:null,data:{routineId:rid,version:1,replayed:false}};
   if(name==='v2_training_routine_archive_owner_candidate')
    return{error:null,data:{routineId:rid,version:1,archived:true,replayed:false}};
   return{error:'unknown rpc',data:null};
  },
 };
 const identity={ownerId:a,sessionGeneration:4,isCurrent:()=>active&&owner===a};
 const reader=createStagedSavedRoutineReadServices(transport,identity);
 const writer=createStagedSavedRoutineMutationServices(transport,identity,reader);
 return{calls,reader,writer,switchAccount:()=>{owner=b;},revoke:()=>{active=false;}};
};
test('authenticated owner list and exact version use only four narrow RPC names',async()=>{
 const f=make();
 const page=await f.reader.readListPage({expectedOwnerId:a,sessionGeneration:4,cursor:null,limit:100});
 assert.equal(page.snapshotVersion,'routine-epoch:1');
 const detail=await f.reader.readVersion({expectedOwnerId:a,sessionGeneration:4,routineId:rid,version:1});
 assert.equal(detail,null);
 assert.deepEqual(f.calls.map(c=>c.name),
 ['v2_training_routine_list_owner_candidate','v2_training_routine_read_owner_candidate']);
});
test('client account change blocks reads before any RPC',async()=>{
 const f=make();f.switchAccount();
 await assert.rejects(()=>f.reader.readListPage({expectedOwnerId:a,sessionGeneration:4,cursor:null,limit:100}));
 assert.equal(f.calls.length,0);
});
test('revoked client generation blocks writes before any RPC',async()=>{
 const f=make();f.revoke();
 await assert.rejects(()=>f.writer.archiveFromUserAction({
  expectedOwnerId:a,sessionGeneration:4,routineId:rid,expectedVersion:1,actionId:action,
 }));
 assert.equal(f.calls.length,0);
});
test('save requires authored structure, fresh action ID and server receipt',async()=>{
 const f=make();
 let draft=addRoutineBlock(newRoutineDraft('strength'));
 const first=draft.blocks[0];
 assert.equal(first.kind,'strength');
 if(first.kind!=='strength')return;
 draft=updateRoutineBlock(draft,{...first,exercise:'Squat',sets:3,reps:'5'});
 const receipt=await f.writer.saveFromUserAction({
  expectedOwnerId:a,sessionGeneration:4,routineId:null,expectedVersion:0,
  actionId:action,draft,
 });
 assert.deepEqual(receipt,{routineId:rid,version:1,replayed:false});
 assert.equal(f.calls[0].name,'v2_training_routine_save_owner_candidate');
 assert.equal(f.calls[0].args.p_expected_version,0);
 assert.equal(f.calls[0].args.p_routine_id,null);
 await assert.rejects(()=>f.writer.saveFromUserAction({
  expectedOwnerId:a,sessionGeneration:4,routineId:null,expectedVersion:0,
  actionId:'fake',draft,
 }));
});
test('archive is explicitly invoked and owner version-bound',async()=>{
 const f=make();
 const archived=await f.writer.archiveFromUserAction({
  expectedOwnerId:a,sessionGeneration:4,routineId:rid,expectedVersion:1,actionId:action,
 });
 assert.equal(archived.archived,true);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].name,'v2_training_routine_archive_owner_candidate');
 assert.equal(f.calls[0].args.p_expected_version,1);
});
