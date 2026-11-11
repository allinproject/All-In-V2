import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyCommunityPostsRead,readCertifiedCommunityPosts}
 from './communityPostsOwnerRead.ts';
import type {CommunityPostsResponse} from './communityPostsOwnerRead.ts';
import type {PublicProfileViewer} from './publicProfilePolicy.ts';
const viewer=(x:Partial<PublicProfileViewer>={}):PublicProfileViewer=>({
 ownerId:'athlete-1',viewerId:'athlete-2',profileVisibility:'public',
 relationship:'not_following',shareGeneralArea:false,sharedArea:null,...x,
});
const post=(audience:'public'|'followers'|'private'='public')=>({
 id:'post-1',ownerId:'athlete-1',kind:'workout' as const,audience,
 title:'Long run',body:'A controlled post',publishedAt:'2026-11-11T12:00:00Z',
 updatedAt:'2026-11-11T12:00:00Z',
});
const response=(x:Partial<CommunityPostsResponse>={}):CommunityPostsResponse=>({
 ownerId:'athlete-1',viewerId:'athlete-2',
 complete:true,nextCursor:null,blocked:false,posts:[post()],...x,
});
test('public post with server-certified public profile succeeds',()=>{
 assert.equal(certifyCommunityPostsRead(response(),'athlete-1',viewer()).length,1);
});
test('private athlete public-audience post cannot be transmitted to stranger',()=>{
 assert.throws(()=>certifyCommunityPostsRead(response(),'athlete-1',
  viewer({profileVisibility:'private'})),/unauthorized post/);
});
test('followers audience requires approved relationship; private stays owner-only',()=>{
 assert.throws(()=>certifyCommunityPostsRead(response({posts:[post('followers')]}),
  'athlete-1',viewer()),/unauthorized post/);
 assert.equal(certifyCommunityPostsRead(response({posts:[post('followers')]}),
  'athlete-1',viewer({relationship:'approved_follower'})).length,1);
 assert.throws(()=>certifyCommunityPostsRead(response({posts:[post('private')]}),
  'athlete-1',viewer({relationship:'approved_follower'})),/unauthorized post/);
});
test('both-direction blocks require completely empty backend posts',()=>{
 const v=viewer({relationship:'blocked_either_way'});
 assert.deepEqual(certifyCommunityPostsRead(response({posts:[],blocked:true}),
   'athlete-1',v),[]);
 assert.throws(()=>certifyCommunityPostsRead(response({blocked:true}),
   'athlete-1',v),/leaked blocked/);
 assert.throws(()=>certifyCommunityPostsRead(response({posts:[]}),
   'athlete-1',v),/block evidence/);
});
test('truncated feed or cursor must not be represented as complete',()=>{
 assert.throws(()=>certifyCommunityPostsRead(response({complete:false,
  nextCursor:'additional-page-required'}),'athlete-1',viewer()),/partial/);
 assert.throws(()=>certifyCommunityPostsRead(response({nextCursor:'page2'}),
  'athlete-1',viewer()),/partial/);
});
test('wrong owner, duplicate post ID and foreign rows fail closed',()=>{
 assert.throws(()=>certifyCommunityPostsRead(response({viewerId:'other'}),
  'athlete-1',viewer()),/foreign/);
 assert.throws(()=>certifyCommunityPostsRead(response({posts:[post(),post()]}),
  'athlete-1',viewer()),/Invalid/);
 assert.throws(()=>certifyCommunityPostsRead(response({
  posts:[{...post(),ownerId:'other'}]}),'athlete-1',viewer()),/Invalid/);
});
test('account switch during asynchronous read rejects bytes',async()=>{
 let generation=4;
 await assert.rejects(readCertifiedCommunityPosts({
  expectedOwnerId:'athlete-1',
  active:async()=>({id:'athlete-2',generation}),
  relationship:async()=>viewer(),
  read:async()=>{generation++;return response();},
 }),/account changed/);
});
test('cancelled screen cannot start Community read',async()=>{
 let reads=0;
 await assert.rejects(readCertifiedCommunityPosts({
  expectedOwnerId:'athlete-1',
  active:async()=>({id:'athlete-2',generation:4}),
  relationship:async()=>viewer(),
  read:async()=>{reads++;return response();},
  isCurrent:()=>false,
 }),/session unavailable/);
 assert.equal(reads,0);
});
