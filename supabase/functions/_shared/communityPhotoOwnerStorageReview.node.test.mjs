import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCommunityPhotoAttachment as review} from './communityPhotoOwnerStorageReview.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const POST='33333333-3333-4333-8333-333333333333';
const row={id:POST,owner_id:A,post_version:2,kind:'update',audience:'followers'};
function fixture(overrides={}){
 const calls={auth:0,post:0,writer:0};
 const input={
  bearer:'Bearer verified-test-session',postId:POST,expectedPostVersion:2,
  photo:{bytes:new Uint8Array([1,2,3]),contentType:'image/png',filename:'run.png'},
  authenticateOwner:async()=>{calls.auth++;return {ownerId:A,active:true,deletionPending:false};},
  readCanonicalPost:async()=>{calls.post++;return row;},
  decodeAndReencode:async()=>{throw Error('should not decode invalid input');},
  privateStorageWriter:{write:async()=>{calls.writer++;throw Error('must stay disabled');}},
  ...overrides,
 };
 return {calls,input};
}
test('rejects missing verified session, ID, and post CAS version without reading any posts',async()=>{
 for(const data of [{bearer:''},{postId:'invalid'},{expectedPostVersion:0}]){
  const {calls,input}=fixture(data);
  assert.equal((await review(input)).status,'denied');
  assert.equal(calls.auth,0);assert.equal(calls.post,0);assert.equal(calls.writer,0);
 }
});
test('a foreign owner cannot process or write a Community photo',async()=>{
 const {calls,input}=fixture({authenticateOwner:async()=>{calls.auth++;return {ownerId:B,active:true};}});
 assert.deepEqual(await review(input),{status:'denied',reason:'post_owner_or_version_mismatch'});
 assert.equal(calls.post,1);assert.equal(calls.writer,0);
});
test('stale post version, replaced audience, and missing post all fail closed',async()=>{
 for(const post of [{...row,post_version:3},{...row,audience:'invalid'},null]){
  const {calls,input}=fixture({readCanonicalPost:async()=>{calls.post++;return post;}});
  assert.equal((await review(input)).reason,'post_owner_or_version_mismatch');
  assert.equal(calls.writer,0);
 }
});
test('inactive or deletion-pending accounts cannot read posts or attempt photo processing',async()=>{
 for(const session of [{ownerId:A,active:false},{ownerId:A,active:true,deletionPending:true}]){
  const {calls,input}=fixture({authenticateOwner:async()=>{calls.auth++;return session;}});
  assert.equal((await review(input)).reason,'owner_unavailable');
  assert.equal(calls.post,0);assert.equal(calls.writer,0);
 }
});
test('valid owner and post cannot upload while photo sanitation or Community Storage is unapproved',async()=>{
 const {calls,input}=fixture();
 assert.equal((await review(input)).reason,'photo_processing_unavailable_or_rejected');
 assert.equal(calls.auth,1);assert.equal(calls.post,1);assert.equal(calls.writer,0);
});
test('errors in session or canonical post reader deny rather than fall back to a client owner',async()=>{
 for(const key of ['authenticateOwner','readCanonicalPost']){
  const {calls,input}=fixture({[key]:async()=>{throw Error('backend unavailable');}});
  assert.equal((await review(input)).reason,'owner_verification_failed');
  assert.equal(calls.writer,0);
 }
});
