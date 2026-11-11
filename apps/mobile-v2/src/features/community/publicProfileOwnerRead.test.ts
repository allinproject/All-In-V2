import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyPublicProfileSnapshot,readCertifiedPublicProfile,
 type CanonicalPublicProfileSnapshot} from './publicProfileOwnerRead.ts';

const posts=[
 {id:'p1',ownerId:'athlete-A',audience:'public' as const,title:'Morning run'},
 {id:'p2',ownerId:'athlete-A',audience:'followers' as const,title:'Followers update'},
 {id:'p3',ownerId:'athlete-A',audience:'private' as const,title:'Personal notes'},
];
const races=[
 {id:'r1',ownerId:'athlete-A',audience:'public' as const,eventName:'Race one'},
 {id:'r2',ownerId:'athlete-A',audience:'followers' as const,eventName:'Race two'},
];
const base=():CanonicalPublicProfileSnapshot=>({
 ownerId:'athlete-A',viewerId:'athlete-B',sessionGeneration:4,revision:7,complete:true,nextCursor:null,
 displayName:'Trail Runner',profile:{ownerId:'athlete-A',viewerId:'athlete-B',
  profileVisibility:'private',relationship:'not_following',shareGeneralArea:false,sharedArea:null},
 posts:[],races:[],
});
test('private profile may return identity but never unauthorized posts or races',()=>{
 const s=certifyPublicProfileSnapshot(base(),'athlete-A','athlete-B',4);
 assert.equal(s.status,'ready');
 assert.equal(s.posts.length,0);assert.equal(s.races.length,0);
 assert.throws(()=>certifyPublicProfileSnapshot({...base(),posts:[posts[0]]},'athlete-A','athlete-B',4),/unauthorized post/);
 assert.throws(()=>certifyPublicProfileSnapshot({...base(),races:[races[0]]},'athlete-A','athlete-B',4),/unauthorized event/);
});
test('approved follower only receives public and followers posts, not private items',()=>{
 const b=base();b.profile.relationship='approved_follower';
 b.posts=[posts[0],posts[1]];b.races=[races[0],races[1]];
 const s=certifyPublicProfileSnapshot(b,'athlete-A','athlete-B',4);
 assert.deepEqual(s.posts.map(p=>p.id),['p1','p2']);
 assert.deepEqual(s.races.map(r=>r.id),['r1','r2']);
 assert.throws(()=>certifyPublicProfileSnapshot({...b,posts:[...b.posts,posts[2]]},'athlete-A','athlete-B',4),/unauthorized post/);
});
test('public profile still cannot return non-public post or event records to strangers',()=>{
 const b=base();b.profile.profileVisibility='public';b.posts=[posts[0]];b.races=[races[0]];
 const s=certifyPublicProfileSnapshot(b,'athlete-A','athlete-B',4);
 assert.deepEqual(s.posts.map(p=>p.id),['p1']);
 assert.deepEqual(s.races.map(r=>r.id),['r1']);
 assert.throws(()=>certifyPublicProfileSnapshot({...b,posts:[posts[1]]},'athlete-A','athlete-B',4),/unauthorized post/);
});
test('blocked profile returns blank state only from an actually sanitized server response',()=>{
 const b=base();b.profile.relationship='blocked_either_way';
 b.displayName=null;
 const s=certifyPublicProfileSnapshot(b,'athlete-A','athlete-B',4);
 assert.equal(s.status,'blocked');
 assert.equal(s.displayName,null);
 assert.equal(s.posts.length,0);assert.equal(s.races.length,0);
 assert.throws(()=>certifyPublicProfileSnapshot({...b,displayName:'Hidden athlete'},'athlete-A','athlete-B',4),/exposed blocked/);
 assert.throws(()=>certifyPublicProfileSnapshot({...b,posts:[posts[0]]},'athlete-A','athlete-B',4),/exposed blocked/);
 assert.throws(()=>certifyPublicProfileSnapshot({...b,profile:{...b.profile,sharedArea:'Hidden home'}},'athlete-A','athlete-B',4),/exposed blocked/);
});
test('partial, stale, foreign or incompatible data cannot turn into a ready profile',()=>{
 const b=base();
 for(const update of [{complete:false},{nextCursor:'page2'},{revision:0},{viewerId:'other'},
 {ownerId:'other'},{sessionGeneration:3}]){
  assert.throws(()=>certifyPublicProfileSnapshot({...b,...update},'athlete-A','athlete-B',4),/Incomplete/);
 }
 assert.throws(()=>certifyPublicProfileSnapshot({...b,posts:[{...posts[0],ownerId:'other'}]},'athlete-A','athlete-B',4),/Invalid Community/);
 assert.throws(()=>certifyPublicProfileSnapshot({...b,posts:[{...posts[0],audience:'invented' as 'public'}]},'athlete-A','athlete-B',4),/Invalid Community/);
});
test('account switches or generation refresh during network read invalidate the result',async()=>{
 let generation=4;
 await assert.rejects(readCertifiedPublicProfile('athlete-A',async()=>({id:'athlete-B',generation}),
  async()=>{generation=5;return base();}),/account changed/);
 let read=false;
 await assert.rejects(readCertifiedPublicProfile('athlete-A',async()=>({id:'athlete-B',generation:4}),
  async()=>{read=true;return base();},()=>false),/no longer active/);
 assert.equal(read,false);
});

test('the server must omit optional general area when not explicitly shareable',()=>{
 const b=base();
 assert.throws(()=>certifyPublicProfileSnapshot({...b,profile:{...b.profile,sharedArea:'Private address'}},'athlete-A','athlete-B',4),/unshared athlete location/);
 const shared={...b,profile:{...b.profile,profileVisibility:'public' as const,
  shareGeneralArea:true,sharedArea:'General area'}};
 assert.equal(certifyPublicProfileSnapshot(shared,'athlete-A','athlete-B',4).profile.visibleGeneralArea,'General area');
});
