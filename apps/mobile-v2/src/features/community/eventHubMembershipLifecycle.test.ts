import test from 'node:test';
import assert from 'node:assert/strict';
import {executeCertifiedEventHubMembership} from './eventHubMembershipLifecycle.ts';
import type {EventHubMemberSnapshot,EventHubMemberAction}
 from './eventHubMembershipLifecycle.ts';
import type {EventHubResolution} from './eventHubUrlIntent.ts';

const a='00000000-0000-0000-0000-000000000001';
const e='00000000-0000-0000-0000-000000000002';
const g='00000000-0000-0000-0000-000000000003';
const k='11111111-1111-4111-8111-111111111111';
const joinedAt='2026-11-11T15:00:00Z';
const resolution=():EventHubResolution=>({
 actorId:a,actionId:'url-action',submittedUrl:'https://race.example.org/e',
 status:'matched',eventId:e,groupId:g,verifiedIdentity:true,joined:false,
});
const start=():EventHubMemberSnapshot=>({
 athleteId:a,eventId:e,groupId:g,verifiedEventIdentity:true,
 joined:false,participantVisible:false,joinedAt:null,version:5,
});
function harness(action:EventHubMemberAction,changes:Record<string,unknown>={}){
 let snapshot=start();let writes=0;
 const args={
  actorId:a,eventId:e,groupId:g,action,actionId:k,
  active:async()=>({id:a,generation:3}),
  read:async()=>({...snapshot}),
  resolution:resolution(),
  write:async()=>{
   writes++;
   if(action==='join')snapshot={...snapshot,joined:true,participantVisible:false,joinedAt,version:6};
   if(action==='leave')snapshot={...snapshot,joined:false,participantVisible:false,joinedAt:null,version:6};
   if(action==='show_participation')snapshot={...snapshot,participantVisible:true,version:6};
   if(action==='hide_participation')snapshot={...snapshot,participantVisible:false,version:6};
   return {actorId:a,eventId:e,groupId:g,action,actionId:k,version:6,accepted:true};
  },...changes,
 };
 return {run:()=>executeCertifiedEventHubMembership(args),writes:()=>writes};
}
test('verified event URL enables explicit membership without auto-enumeration',async()=>{
 const {run,writes}=harness('join');
 const after=await run();
 assert.equal(after.joined,true);
 assert.equal(after.participantVisible,false);
 assert.equal(writes(),1);
});
test('an unverified URL, wrong group or implicit prior join cannot grant entry',async()=>{
 for(const wrong of [
  {status:'conflict'},{verifiedIdentity:false},{groupId:'other'},
  {actorId:'other'},{joined:true},
 ]){
  const x=harness('join',{resolution:{...resolution(),...wrong}});
  await assert.rejects(x.run(),/verified exact/);
  assert.equal(x.writes(),0);
 }
});
test('participant discovery remains opt-in separate from EventHub join',async()=>{
 const x=harness('show_participation',{
  read:async()=>({...start(),joined:true,joinedAt}),
 });
 await assert.rejects(x.run(),/fresh owner-confirmed/);
 const y=harness('show_participation');
 await assert.rejects(y.run(),/action unavailable/);
 assert.equal(y.writes(),0);
});
test('leave revokes public participant evidence without deleting historical posts',async()=>{
 let state={...start(),joined:true,joinedAt,participantVisible:true};
 const after=await executeCertifiedEventHubMembership({
  actorId:a,eventId:e,groupId:g,actionId:k,action:'leave',
  active:async()=>({id:a,generation:3}),
  read:async()=>({...state}),
  write:async()=>{state={...state,joined:false,joinedAt:null,participantVisible:false,version:6};
    return {actorId:a,eventId:e,groupId:g,action:'leave',actionId:k,accepted:true,version:6};},
 });
 assert.equal(after.joined,false);
 assert.equal(after.participantVisible,false);
});
test('accepted write receipt alone cannot prove actual membership',async()=>{
 const x=harness('join',{write:async()=>({
  actorId:a,eventId:e,groupId:g,action:'join',actionId:k,version:6,accepted:true,
 })});
 await assert.rejects(x.run(),/fresh owner-confirmed/);
});
test('wrong version or actor on receipt is rejected',async()=>{
 const x=harness('join',{write:async()=>({
  actorId:'other',eventId:e,groupId:g,action:'join',actionId:k,version:6,accepted:true,
 })});
 await assert.rejects(x.run(),/Unverified/);
});
test('changing account before a write prevents mutation',async()=>{
 let calls=0;
 const x=harness('join',{active:async()=>({
  id:a,generation:++calls===1?3:4,
 })});
 await assert.rejects(x.run(),/account changed/);
 assert.equal(x.writes(),0);
});
test('same group must belong to canonical verified event owner',async()=>{
 const x=harness('join',{read:async()=>({...start(),eventId:'other'})});
 await assert.rejects(x.run(),/foreign/);
 assert.equal(x.writes(),0);
});
test('no id, no screen or invalid action can trigger writer',async()=>{
 for(const changes of [{actionId:'not-uuid'},{isCurrent:()=>false},
  {action:'register_for_race'}]){
  const x=harness('join',changes);
  await assert.rejects(x.run());
  assert.equal(x.writes(),0);
 }
});
