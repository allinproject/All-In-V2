import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoachOwnerClient,type CoachServices} from './coachOwnerClient.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const thread='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const request='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const userMessage='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const assistantMessage='ffffffff-ffff-4fff-8fff-ffffffffffff';
const command={threadId:thread,clientRequestId:request,userMessageId:userMessage,
 assistantMessageId:assistantMessage,message:'What is my run today?'};
function fixture(){
 let id=owner,token='token-a',calls=0;
 const services:CoachServices={
  session:async()=>({ownerId:id,token}),
  request:async body=>{
   calls++;
   if(body.action==='open')return {status:'ok',threadId:thread};
   if(body.action==='history')return {status:'ok',hasMore:false,messages:[{
    id:userMessage,threadId:thread,role:'user',content:'Run?',createdAt:'2026-11-12T20:00:00Z'
   }]};
   return {status:'ok',message:'Verified saved answer',receipt:{
    ownerId:owner,threadId:thread,clientRequestId:request,
    userMessageId:userMessage,assistantMessageId:assistantMessage}};
  }
 };
 return {services,calls:()=>calls,swap:()=>{id=other},rotate:()=>{token='token-b'}};
}
test('default-off mobile Coach cannot invoke owner RPC or paid sends',async()=>{
 const x=fixture(),client=createCoachOwnerClient(x.services,owner,()=>true,false,false);
 assert.equal((await client.open(thread)).status,'unavailable');
 assert.equal((await client.send(command)).status,'unavailable');
 assert.equal(x.calls(),0);
});
test('canonical first-open, transcript and exact save receipt require verified session',async()=>{
 const x=fixture(),client=createCoachOwnerClient(x.services,owner,()=>true,true,true);
 const open=await client.open(thread);
 assert.deepEqual(open,{status:'ready',threadId:thread});
 const history=await client.history(thread);
 assert.equal(history.status,'ready');
 if(history.status==='ready')assert.equal(history.messages[0].role,'user');
 const sent=await client.send(command);
 assert.equal(sent.status,'saved');
 if(sent.status==='saved')assert.equal(sent.receipt.assistantMessageId,assistantMessage);
 assert.equal(x.calls(),3);
});
test('owner switch before readback blocks response',async()=>{
 const x=fixture();let calls=0;
 x.services.request=async()=>{calls++;x.swap();return {status:'ok',threadId:thread};};
 const client=createCoachOwnerClient(x.services,owner,()=>true,true,true);
 assert.equal((await client.open(thread)).status,'unavailable');
 assert.equal(calls,1);
});
test('token refresh for the same owner preserves conversation continuity',async()=>{
 const x=fixture();
 x.services.request=async()=>{x.rotate();return {status:'ok',threadId:thread};};
 const client=createCoachOwnerClient(x.services,owner,()=>true,true,true);
 assert.deepEqual(await client.open(thread),{status:'ready',threadId:thread});
 assert.deepEqual(await client.open(thread),{status:'ready',threadId:thread});
});
test('same-owner reauthentication invalidates an in-flight Coach response',async()=>{
 const x=fixture();let generation=4;
 x.services.request=async()=>{generation++;x.rotate();return {status:'ok',threadId:thread};};
 const launchedGeneration=generation;
 const client=createCoachOwnerClient(x.services,owner,
  ()=>generation===launchedGeneration,true,true);
 assert.equal((await client.open(thread)).status,'unavailable');
});
test('cross-owner and invented model replies are never treated as saved',async()=>{
 const x=fixture();x.services.request=async()=>({status:'ok',message:'generated',
  receipt:{ownerId:other,threadId:thread,clientRequestId:request,
  userMessageId:userMessage,assistantMessageId:assistantMessage}});
 const c=createCoachOwnerClient(x.services,owner,()=>true,true,true);
 assert.equal((await c.send(command)).status,'unavailable');
 const y=fixture();y.services.request=async()=>({status:'ok',message:'generated'});
 assert.equal((await createCoachOwnerClient(y.services,owner,()=>true,true,true).send(command)).status,'unavailable');
});
test('unauthorized or mixed-thread history fails closed',async()=>{
 const x=fixture();x.services.request=async()=>({status:'ok',hasMore:false,messages:[{
  id:userMessage,threadId:other,role:'assistant',content:'private',
  createdAt:'2026-11-12T20:00:00Z'}]});
 assert.equal((await createCoachOwnerClient(x.services,owner,()=>true,true).history(thread)).status,'unavailable');
});

test('canonical history cursor is bound to oldest verified message, not an arbitrary caller cursor',async()=>{
 const x=fixture();
 const older='11111111-1111-4111-8111-111111111111';
 const earlier='2026-11-12T19:00:00Z';
 const later='2026-11-12T20:00:00Z';
 const cursor={beforeCreatedAt:later,beforeMessageId:userMessage};
 let received:unknown=null;
 x.services.request=async body=>{
  received=body.cursor;
  return {status:'ok',hasMore:true,messages:[{
   id:older,threadId:thread,role:'assistant',content:'Older answer',createdAt:earlier
  }],nextCursor:{beforeCreatedAt:earlier,beforeMessageId:older}};
 };
 const c=createCoachOwnerClient(x.services,owner,()=>true,true);
 const page=await c.history(thread,cursor);
 assert.equal(page.status,'ready');
 if(page.status==='ready')assert.deepEqual(page.nextCursor,
  {beforeCreatedAt:earlier,beforeMessageId:older});
 assert.deepEqual(received,cursor);
});
test('forged history cursor, duplicate messages, or newer-than-cursor records fail closed',async()=>{
 const x=fixture();
 const c=createCoachOwnerClient(x.services,owner,()=>true,true);
 assert.equal((await c.history(thread,{beforeCreatedAt:'bad',beforeMessageId:userMessage})).status,'unavailable');
 x.services.request=async()=>({status:'ok',hasMore:true,messages:[{
  id:userMessage,threadId:thread,role:'user',content:'Hello',createdAt:'2026-11-12T20:00:00Z'
 }],nextCursor:{beforeCreatedAt:'2026-11-12T19:00:00Z',beforeMessageId:userMessage}});
 assert.equal((await c.history(thread)).status,'unavailable');
 x.services.request=async()=>({status:'ok',hasMore:false,messages:[{
  id:userMessage,threadId:thread,role:'user',content:'Hello',createdAt:'2026-11-12T21:00:00Z'
 }]});
 assert.equal((await c.history(thread,{
  beforeCreatedAt:'2026-11-12T20:00:00Z',beforeMessageId:assistantMessage
 })).status,'unavailable');
});
