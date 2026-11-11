import test from 'node:test';
import assert from 'node:assert/strict';
import {executeCertifiedRelationshipAction} from './publicProfileRelationshipLifecycle.ts';
import type {RelationshipSnapshot} from './publicProfileRelationshipIntent.ts';

const initial=():RelationshipSnapshot=>({
 viewerId:'owner-A',targetOwnerId:'owner-B',targetVisibility:'private',
 relationship:'not_following',incomingRequestFromTarget:false,
 viewerBlockedTarget:false,version:3,
});
const receipt=(action:string,version=4)=>({
 actorId:'owner-A',targetOwnerId:'owner-B',actionId:'stable-key',
 action:action as 'request_follow',version,accepted:true,
});
const run=(overrides:Record<string,unknown>={})=>{
 const state={...initial()};
 const args={
  expectedActorId:'owner-A',targetId:'owner-B',
  action:'request_follow' as const,stableActionId:'stable-key',
  active:async()=>({id:'owner-A',generation:2}),
  reader:async()=>({...state}),
  writer:async()=>{state.relationship='follow_requested' as const;state.version=4;return receipt('request_follow');},
  ...overrides,
 };
 return executeCertifiedRelationshipAction(args);
};

test('fresh server state is required for a successful follow request',async()=>{
 const result=await run();
 assert.equal(result.intent.expectedVersion,3);
 assert.equal(result.snapshot.relationship,'follow_requested');
 assert.equal(result.snapshot.version,4);
});
test('an accepted receipt alone does not grant following state',async()=>{
 await assert.rejects(run({writer:async()=>receipt('request_follow')}),/lacks current matching/);
});
test('a stale/newer unrelated revision is rejected rather than silently confirming',async()=>{
 await assert.rejects(run({writer:async()=>receipt('request_follow',5)}),/lacks current matching/);
});
test('foreign or mismatched receipt action cannot confirm a mutation',async()=>{
 await assert.rejects(run({writer:async()=>receipt('block')}),/Unverified/);
});
test('writer cannot run under a changed account or session generation',async()=>{
 let reads=0; let writes=0;
 await assert.rejects(run({
  active:async()=>({id:'owner-A',generation:reads++===0?2:3}),
  writer:async()=>{writes++;return receipt('request_follow');},
 }),/account changed before mutation/);
 assert.equal(writes,0);
});
test('account switch after writer prevents accepting a stale receipt',async()=>{
 let sessionReads=0;
 await assert.rejects(run({
  active:async()=>({id:'owner-A',generation:++sessionReads<=2?2:3}),
 }),/account changed during mutation/);
});
test('server reader must return exact actor and target identity',async()=>{
 await assert.rejects(run({reader:async()=>({...initial(),viewerId:'other'})}),/foreign/);
});
test('blocked target cannot be followed and writer is never called',async()=>{
 let writes=0;
 await assert.rejects(run({
  reader:async()=>({...initial(),relationship:'blocked_either_way'}),
  writer:async()=>{writes++;return receipt('request_follow');},
 }),/unavailable/);
 assert.equal(writes,0);
});
test('report remains blocked without approved moderation owner',async()=>{
 let writes=0;
 await assert.rejects(run({
  action:'report',
  writer:async()=>{writes++;return receipt('request_follow');},
 }),/moderation/);
 assert.equal(writes,0);
});
test('successful block requires fresh own-block evidence, not either-direction block',async()=>{
 let readCount=0;
 const reader=async()=>{
  readCount++;
  return readCount===1?{...initial()}:{
   ...initial(),version:4,relationship:'blocked_either_way' as const,viewerBlockedTarget:false
  };
 };
 await assert.rejects(run({action:'block',reader,writer:async()=>receipt('block')}),/lacks current matching/);
});
test('changing the visible screen prevents any network mutation',async()=>{
 let writes=0;
 await assert.rejects(run({isCurrent:()=>false,writer:async()=>{writes++;return receipt('request_follow');}}),/no longer active/);
 assert.equal(writes,0);
});
