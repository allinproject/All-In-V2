import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCanonicalSourceShare} from './communitySourceShareIntent.ts';
const actor='00000000-0000-0000-0000-000000000001';
const post='00000000-0000-0000-0000-000000000002';
const action='11111111-1111-4111-8111-111111111111';
const sourceId='00000000-0000-0000-0000-000000000003';
const base=()=>({
 actorId:actor,postId:post,actionId:action,
 source:{sourceKind:'workout' as const,sourceId,sourceOwnerId:actor,
  sourceVersion:4,sourceState:'completed' as const,verifiedCanonicalSource:true},
 audience:'public' as const,explicitAthleteApproval:true,
});
test('explicitly shared completed canonical workout maps to one post proposal',()=>{
 const proposed=prepareCanonicalSourceShare(base());
 assert.equal(proposed.sourceKind,'workout');
 assert.equal(proposed.postId,post);
 assert.equal(proposed.sourceVersion,4);
 assert.equal(proposed.explicitAthleteApproval,true);
});
test('a completed meal source uses Fuel identity, not a new Community food log',()=>{
 const proposed=prepareCanonicalSourceShare({...base(),source:{
  ...base().source,sourceKind:'food',
 }});
 assert.equal(proposed.sourceKind,'food');
 assert.equal(proposed.sourceId,sourceId);
});
test('planned, imported, suggested or foreign-owned sources are not published',()=>{
 for(const changes of [
  {sourceState:'planned'},{sourceState:'suggested'},
  {sourceState:'imported_unreviewed'},{sourceOwnerId:'other'},
  {sourceVersion:0},{verifiedCanonicalSource:false},{sourceId:'not-uuid'},
 ]){
  const x=base();
  assert.throws(()=>prepareCanonicalSourceShare({...x,source:{
   ...x.source,...changes,
  }}),/Canonical completed/);
 }
});
test('no explicit user share gesture cannot become automatic Community post',()=>{
 const x=base();
 assert.throws(()=>prepareCanonicalSourceShare({
  ...x,explicitAthleteApproval:false,
 }),/explicit athlete approval/);
});
test('action/post owner identity and audience must be valid',()=>{
 for(const overrides of [
  {actorId:'other'},{postId:'not-uuid'},{actionId:''},{audience:'world'},
 ]){
  const x=base();
  assert.throws(()=>prepareCanonicalSourceShare({...x,...overrides}),
   /Canonical completed/);
 }
});
