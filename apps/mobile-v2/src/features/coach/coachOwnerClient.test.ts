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
test('owner switch or session-token rotation before readback blocks response',async()=>{
 for(const kind of ['owner','token']){
  const x=fixture();let currentCalls=0;
  x.services.request=async()=>{
   currentCalls++;if(kind==='owner')x.swap();else x.rotate();
   return {status:'ok',threadId:thread};
  };
  const client=createCoachOwnerClient(x.services,owner,()=>true,true,true);
  assert.equal((await client.open(thread)).status,'unavailable');
  assert.equal(currentCalls,1);
 }
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
