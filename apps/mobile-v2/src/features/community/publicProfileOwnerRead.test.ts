import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyPublicProfileSnapshot,readCertifiedPublicProfile,
 type CanonicalPublicProfileSnapshot} from './publicProfileOwnerRead.ts';
const base=():CanonicalPublicProfileSnapshot=>({
 ownerId:'athlete-A',viewerId:'athlete-B',sessionGeneration:4,revision:7,complete:true,nextCursor:null,
 displayName:'Trail Runner',profile:{ownerId:'athlete-A',viewerId:'athlete-B',
  profileVisibility:'private',relationship:'not_following',shareGeneralArea:false,sharedArea:'Saint Paul'},
 posts:[{id:'p1',ownerId:'athlete-A',audience:'public',title:'Morning run'},
  {id:'p2',ownerId:'athlete-A',audience:'followers',title:'Followers update'},
  {id:'p3',ownerId:'athlete-A',audience:'private',title:'Personal notes'}],
 races:[{id:'r1',ownerId:'athlete-A',audience:'public',eventName:'Race one'},
  {id:'r2',ownerId:'athlete-A',audience:'followers',eventName:'Race two'}],
});
test('private profile never exposes post or race content to unapproved visitors',()=>{
 const s=certifyPublicProfileSnapshot(base(),'athlete-A','athlete-B',4);
 assert.equal(s.status,'ready');
 assert.equal(s.posts.length,0);assert.equal(s.races.length,0);
});
test('approved follower views public and followers posts, not private posts',()=>{
 const b=base();b.profile.relationship='approved_follower';
 const s=certifyPublicProfileSnapshot(b,'athlete-A','athlete-B',4);
 assert.deepEqual(s.posts.map(p=>p.id),['p1','p2']);
 assert.deepEqual(s.races.map(r=>r.id),['r1','r2']);
});
test('public profile still protects private and followers-only posts',()=>{
 const b=base();b.profile.profileVisibility='public';
 const s=certifyPublicProfileSnapshot(b,'athlete-A','athlete-B',4);
 assert.deepEqual(s.posts.map(p=>p.id),['p1']);
 assert.deepEqual(s.races.map(r=>r.id),['r1']);
});
test('blocked relationship hides identity and all data',()=>{
 const b=base();b.profile.relationship='blocked_either_way';
 const s=certifyPublicProfileSnapshot(b,'athlete-A','athlete-B',4);
 assert.equal(s.status,'blocked');
 assert.equal(s.displayName,null);
 assert.equal(s.posts.length,0);assert.equal(s.races.length,0);
});
test('partial/stale/foreign owner data cannot turn into a ready profile',()=>{
 const b=base();
 for(const update of [{complete:false},{nextCursor:'page2'},{revision:0},{viewerId:'other'},
 {ownerId:'other'},{sessionGeneration:3}]){
  assert.throws(()=>certifyPublicProfileSnapshot({...b,...update},'athlete-A','athlete-B',4),/Incomplete/);
 }
 assert.throws(()=>certifyPublicProfileSnapshot({...b,posts:[{...b.posts[0],ownerId:'other'}]},'athlete-A','athlete-B',4),/Invalid Community/);
});
test('account switches or refreshes during network read invalidate the result',async()=>{
 let generation=4;
 await assert.rejects(readCertifiedPublicProfile('athlete-A',async()=>({id:'athlete-B',generation}),
  async()=>{generation=5;return base();}),/account changed/);
 let read=false;
 await assert.rejects(readCertifiedPublicProfile('athlete-A',async()=>({id:'athlete-B',generation:4}),
  async()=>{read=true;return base();},()=>false),/no longer active/);
 assert.equal(read,false);
});
