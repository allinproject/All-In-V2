import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCertifiedCommunityVisibility} from './communityVisibilityLifecycle.ts';

function exercise(overrides:Record<string,unknown>={}){
 let state={ownerId:'actor-1',visibility:'private' as const|'public',version:4};
 let writes=0;
 const args={
  expectedOwnerId:'actor-1',
  nextVisibility:'public' as const,
  active:async()=>({id:'actor-1',generation:3}),
  read:async()=>({...state}),
  write:async()=>{writes++;state={...state,visibility:'public',version:5};
   return {...state,changed:true};},
  ...overrides,
 };
 return {run:()=>changeCertifiedCommunityVisibility(args),writes:()=>writes};
}
test('owner can change private to public only after fresh matching readback',async()=>{
 const x=exercise();
 assert.deepEqual(await x.run(),{ownerId:'actor-1',visibility:'public',version:5});
 assert.equal(x.writes(),1);
});
test('a successful receipt with no persisted state never confirms privacy',async()=>{
 const x=exercise({write:async()=>({ownerId:'actor-1',visibility:'public',version:5,changed:true})});
 await assert.rejects(x.run(),/matching current owner read/);
});
test('same visibility is a no-op without advancing version',async()=>{
 const x=exercise({nextVisibility:'private',
  write:async()=>({ownerId:'actor-1',visibility:'private',version:4,changed:false})});
 assert.equal((await x.run()).version,4);
});
test('stale or contradictory receipts are rejected',async()=>{
 for(const receipt of [
  {ownerId:'actor-1',visibility:'public',version:4,changed:true},
  {ownerId:'actor-1',visibility:'public',version:5,changed:false},
  {ownerId:'actor-2',visibility:'public',version:5,changed:true},
  {ownerId:'actor-1',visibility:'public',version:5,changed:'true'},
  {ownerId:'actor-1',visibility:'private',version:5,changed:true},
 ]){
  await assert.rejects(exercise({write:async()=>receipt}).run(),/Unverified/);
 }
});
test('session generation change before write prevents a mutation',async()=>{
 let reads=0;let writes=0;
 const x=exercise({
  active:async()=>({id:'actor-1',generation:++reads===1?3:4}),
  write:async()=>{writes++;return {ownerId:'actor-1',visibility:'public',version:5,changed:true};},
 });
 await assert.rejects(x.run(),/account changed/);
 assert.equal(writes,0);
});
test('session switch after write cannot confirm an old account state',async()=>{
 let count=0;
 const x=exercise({
  active:async()=>({id:++count<3?'actor-1':'actor-2',generation:3}),
 });
 await assert.rejects(x.run(),/account changed/);
});
test('a cross-owner or invalid initial snapshot stops before writer',async()=>{
 let writes=0;
 const x=exercise({
  read:async()=>({ownerId:'other',visibility:'public',version:4}),
  write:async()=>{writes++;return {ownerId:'actor-1',visibility:'public',version:5,changed:true};},
 });
 await assert.rejects(x.run(),/foreign/);
 assert.equal(writes,0);
});
test('cancelled screen cannot submit a privacy update',async()=>{
 let writes=0;
 const x=exercise({isCurrent:()=>false,
  write:async()=>{writes++;return {ownerId:'actor-1',visibility:'public',version:5,changed:true};},
 });
 await assert.rejects(x.run(),/no longer active/);
 assert.equal(writes,0);
});
test('invalid privacy values cannot reach the writer',async()=>{
 let writes=0;
 const x=exercise({nextVisibility:'followers',
  write:async()=>{writes++;return {ownerId:'actor-1',visibility:'public',version:5,changed:true};},
 });
 await assert.rejects(x.run(),/Invalid requested/);
 assert.equal(writes,0);
});
