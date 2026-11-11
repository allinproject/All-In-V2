import test from 'node:test';
import assert from 'node:assert/strict';
import {relationshipActionAvailability,prepareRelationshipMutation,
 verifyRelationshipMutationReceipt,type RelationshipSnapshot} from './publicProfileRelationshipIntent.ts';
const snap=(x:Partial<RelationshipSnapshot>={}):RelationshipSnapshot=>({
 viewerId:'athlete-A',targetOwnerId:'athlete-B',targetVisibility:'private',
 relationship:'not_following',incomingRequestFromTarget:false,viewerBlockedTarget:false,
 version:5,...x,
});
test('private follow starts a request, public follows directly, neither grants access',()=>{
 assert.deepEqual([...relationshipActionAvailability(snap())],['request_follow','block','report']);
 assert.ok(relationshipActionAvailability(snap({targetVisibility:'public'})).has('follow'));
 assert.ok(!relationshipActionAvailability(snap({targetVisibility:'public'})).has('request_follow'));
});
test('pending requests can only be canceled; accepted followers can unfollow',()=>{
 const requested=relationshipActionAvailability(snap({relationship:'follow_requested'}));
 assert.ok(requested.has('cancel_request'));
 assert.ok(!requested.has('request_follow'));
 assert.ok(!requested.has('follow'));
 const following=relationshipActionAvailability(snap({relationship:'approved_follower'}));
 assert.ok(following.has('unfollow'));
 assert.ok(!following.has('follow'));
});
test('incoming request approval and rejection require certified reverse request',()=>{
 assert.equal(relationshipActionAvailability(snap()).has('approve_request'),false);
 const available=relationshipActionAvailability(snap({incomingRequestFromTarget:true}));
 assert.ok(available.has('approve_request'));
 assert.ok(available.has('reject_request'));
});
test('blocked in either direction prevents contact; only own block can be removed',()=>{
 assert.deepEqual([...relationshipActionAvailability(snap({relationship:'blocked_either_way'}))],[]);
 assert.deepEqual([...relationshipActionAvailability(snap({relationship:'blocked_either_way',viewerBlockedTarget:true}))],['unblock']);
 assert.throws(()=>relationshipActionAvailability(snap({viewerBlockedTarget:true})),/Contradictory/);
});
test('intent requires valid owner, expected version, stable action ID and allowed action',()=>{
 const s=snap();
 assert.deepEqual(prepareRelationshipMutation(s,'request_follow','11111111-1111-4111-8111-111111111111'),{
  actorId:'athlete-A',targetOwnerId:'athlete-B',action:'request_follow',
  expectedVersion:5,actionId:'11111111-1111-4111-8111-111111111111',
 });
 assert.throws(()=>prepareRelationshipMutation(s,'approve_request','11111111-1111-4111-8111-111111111111'),/unavailable/);
 assert.throws(()=>prepareRelationshipMutation(s,'request_follow',''),/idempotent/);
 assert.throws(()=>relationshipActionAvailability(snap({targetOwnerId:'athlete-A'})),/Invalid/);
 assert.throws(()=>relationshipActionAvailability(snap({version:0})),/Invalid/);
});
test('only the canonical server-confirmed same-action advancing revision is accepted',()=>{
 const intent=prepareRelationshipMutation(snap(),'request_follow','11111111-1111-4111-8111-111111111111');
 assert.equal(verifyRelationshipMutationReceipt(intent,{
  actorId:'athlete-A',targetOwnerId:'athlete-B',actionId:'11111111-1111-4111-8111-111111111111',action:'request_follow',version:6,accepted:true,
 }),true);
 for(const difference of [{actorId:'other'},{targetOwnerId:'other'},
  {actionId:'other'},{action:'block' as const},{version:5},{accepted:false}]){
  assert.throws(()=>verifyRelationshipMutationReceipt(intent,{
   actorId:'athlete-A',targetOwnerId:'athlete-B',actionId:'11111111-1111-4111-8111-111111111111',
   action:'request_follow' as const,version:6,accepted:true,...difference,
  }),/Unverified/);
 }
});

test('truthy strings cannot forge follow approval or block rights',()=>{
 assert.throws(()=>relationshipActionAvailability(snap({incomingRequestFromTarget:'true' as unknown as boolean})),/Invalid/);
 assert.throws(()=>relationshipActionAvailability(snap({viewerBlockedTarget:'false' as unknown as boolean})),/Invalid/);
});

test('arbitrary or zero action IDs cannot reach the UUID-backed Community writer',()=>{
 for(const bad of ['request-123','stable-key','00000000-0000-0000-0000-000000000000']){
  assert.throws(()=>prepareRelationshipMutation(snap(),'request_follow',bad),/idempotent/);
 }
});
