import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types';
import {readOwnedCompletedActivityLayouts,saveOwnedCompletedActivityLayouts} from './completedActivityLayoutClient.ts';
import {updateMetricLayout} from './completedActivityLayouts.ts';

function mockClient(owner='owner-A'){
 let version=3,settings:Record<string,unknown>={app_preferences:{preferred_theme:'dark'}},callCount=0;
 let activeOwner=owner,conflict=false;
 const mock={
  auth:{getSession:async()=>({data:{session:{user:{id:activeOwner}}},error:null})},
  rpc:async (name:string,args?:Record<string,unknown>)=>{
   if(name==='v2_my_profile_state')return {data:{profile:{user_id:owner},settings:{version,settings}},error:null};
   if(name!=='v2_patch_profile_settings_section')throw Error('Unexpected RPC '+name);
   callCount++;
   if(conflict||args?.p_expected_version!==version)return {data:null,error:{code:'40001',message:'stale version'}};
   if(args?.p_expected_user_id!==owner||args?.p_section!=='app_preferences')throw Error('Wrong RPC owner/section');
   const patch=args?.p_patch as Record<string,unknown>;
   settings={...settings,app_preferences:{...(settings.app_preferences as Record<string,unknown>),...patch}};
   version++;
   return {data:version,error:null};
  },
 } as unknown as SupabaseClient<Database>;
 return {mock,setOwner:(id:string)=>{activeOwner=id;},setConflict:(flag:boolean)=>{conflict=flag;},getCallCount:()=>callCount,getSettings:()=>settings};
}
test('read and save layout preferences through existing owner-checked app_preferences without removing other keys',async()=>{
 const client=mockClient();
 const first=await readOwnedCompletedActivityLayouts(client.mock,'owner-A');
 assert.equal(first.version,3);
 const next=updateMetricLayout(first.layouts,'outdoor_run','details',{order:['pace'],pinned:['pace'],hidden:['cadence']});
 const stored=await saveOwnedCompletedActivityLayouts(client.mock,'owner-A',{layouts:next,expectedVersion:first.version,actionId:'act-1'});
 assert.equal(stored.version,4);
 assert.deepEqual(stored.layouts,next);
 assert.equal((client.getSettings().app_preferences as Record<string,unknown>).preferred_theme,'dark');
 assert.equal(client.getCallCount(),1);
});
test('account switch blocks mutation before writing',async()=>{
 const client=mockClient();client.setOwner('owner-B');
 await assert.rejects(saveOwnedCompletedActivityLayouts(client.mock,'owner-A',{
  layouts:{},expectedVersion:3,actionId:'act-2',
 }),/signed-in account changed/);
 assert.equal(client.getCallCount(),0);
});
test('stale version is rejected rather than clobber newer layouts',async()=>{
 const client=mockClient();client.setConflict(true);
 await assert.rejects(saveOwnedCompletedActivityLayouts(client.mock,'owner-A',{
  layouts:{},expectedVersion:3,actionId:'act-3',
 }),(error:unknown)=>Boolean(error&&typeof error==='object'&&(error as {code?:string}).code==='40001'));
});
test('blurred or cancelled view does not read or write',async()=>{
 const client=mockClient();
 await assert.rejects(saveOwnedCompletedActivityLayouts(client.mock,'owner-A',{
  layouts:{},expectedVersion:3,actionId:'act-4',
 },()=>false),/no longer active/);
 assert.equal(client.getCallCount(),0);
});
