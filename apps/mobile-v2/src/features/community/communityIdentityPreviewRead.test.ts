import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyCommunityIdentityPreview,readCertifiedCommunityIdentityPreview} from './communityIdentityPreviewRead.ts';

const base=()=>({
 ownerId:'athlete-a',viewerId:'athlete-b',displayName:'Trail Runner',
 profileVisibility:'public',relationship:'not_following',relationshipVersion:4,
 blocked:false,sharedArea:null,shareGeneralArea:false,avatarPath:null,contentReady:false,
});
test('canonical identity-only response cannot be represented as a complete timeline',()=>{
 const c=certifyCommunityIdentityPreview(base(),'athlete-a','athlete-b');
 assert.equal(c.status,'identity_only');
 assert.equal(c.displayName,'Trail Runner');
 assert.equal((c as unknown as {posts?:unknown}).posts,undefined);
});
test('blocked user must have null identity, location and empty unavailable status',()=>{
 const b={...base(),blocked:true,profileVisibility:'private',
  relationship:'blocked_either_way',displayName:null};
 const c=certifyCommunityIdentityPreview(b,'athlete-a','athlete-b');
 assert.equal(c.status,'blocked');
 assert.equal(c.displayName,null);
 for(const extra of [
  {displayName:'Hidden Runner'},{sharedArea:'Private city'},
  {avatarPath:'/athlete/profile.png'},{profileVisibility:'public'},
  {blocked:'true'},
 ]){
  assert.throws(()=>certifyCommunityIdentityPreview({...b,...extra},'athlete-a','athlete-b'),
   /over-fetched|leaked/);
 }
});
test('server must not ship extra private fields or pretend the timeline is ready',()=>{
 for(const extra of [{posts:[]},{races:[]},{email:'owner@private.example'},
  {contentReady:true},{shareGeneralArea:true},{sharedArea:'My neighborhood'},
  {avatarPath:'private/path'},{relationshipVersion:0},{relationshipVersion:'4'},
  {profileVisibility:'unknown'},{displayName:'X'.repeat(81)}]){
  assert.throws(()=>certifyCommunityIdentityPreview({...base(),...extra},'athlete-a','athlete-b'),
   /over-fetched/);
 }
});
test('foreign owner/viewer evidence cannot be accepted',()=>{
 assert.throws(()=>certifyCommunityIdentityPreview(base(),'wrong','athlete-b'),/over-fetched/);
 assert.throws(()=>certifyCommunityIdentityPreview(base(),'athlete-a','other'),/over-fetched/);
});
test('identity preview checks account generation before and after read',async()=>{
 let generation=3;
 await assert.rejects(readCertifiedCommunityIdentityPreview({
  expectedOwnerId:'athlete-a',
  active:async()=>({id:'athlete-b',generation}),
  reader:async()=>{generation++;return base();},
 }),/account changed/);
});
test('deactivated screen must not start a reader request',async()=>{
 let calls=0;
 await assert.rejects(readCertifiedCommunityIdentityPreview({
  expectedOwnerId:'athlete-a',
  active:async()=>({id:'athlete-b',generation:3}),
  reader:async()=>{calls++;return base();},
  isCurrent:()=>false,
 }),/session unavailable/);
 assert.equal(calls,0);
});
test('fresh authorized session produces a safe identity-only preview',async()=>{
 const value=await readCertifiedCommunityIdentityPreview({
  expectedOwnerId:'athlete-a',
  active:async()=>({id:'athlete-b',generation:5}),
  reader:async()=>base(),
 });
 assert.equal(value.status,'identity_only');
});
