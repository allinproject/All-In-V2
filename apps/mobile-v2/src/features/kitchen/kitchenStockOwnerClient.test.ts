import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOwnedKitchenStock,readOwnedKitchenStock,type KitchenStockReadServices} from './kitchenStockOwnerClient.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const value=()=>({ownerId:owner,complete:true,pantryLots:[{
 id:'11111111-1111-4111-8111-111111111111',foodId:'banana',
 preparationState:'as_sold',unit:'each',onHand:5,reserved:2,
 location:'pantry',usable:true,expiryDate:null,version:1,
}],manualShopping:[{
 id:'22222222-2222-4222-8222-222222222222',foodId:'banana',
 description:'Extra bananas',preparationState:'as_sold',unit:'each',
 requestedQuantity:3,state:'in_cart',version:2,
}]});
test('only complete owner-verified stock and manual shopping can be shown',()=>{
 assert.equal(parseOwnedKitchenStock(value(),owner)?.pantryLots[0].reserved,2);
 assert.equal(parseOwnedKitchenStock(value(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),null);
 assert.equal(parseOwnedKitchenStock({...value(),complete:false},owner),null);
 assert.equal(parseOwnedKitchenStock({...value(),pantryLots:undefined},owner),null);
 assert.equal(parseOwnedKitchenStock({...value(),pantryLots:[{...value().pantryLots[0],reserved:7}]},owner),null);
 assert.equal(parseOwnedKitchenStock({...value(),pantryLots:[value().pantryLots[0],value().pantryLots[0]]},owner),null);
 assert.equal(parseOwnedKitchenStock({...value(),manualShopping:[{...value().manualShopping[0],state:'purchased'}]},owner),null);
});
test('disabled transport does not claim an empty Pantry',async()=>{
 let calls=0;
 const svc:KitchenStockReadServices={authenticateOwner:async()=>{},
  rpc:async()=>{calls++;return {data:value(),error:null};}};
 assert.deepEqual(await readOwnedKitchenStock(svc,owner,()=>true,false),{status:'unavailable'});
 assert.equal(calls,0);
 assert.equal((await readOwnedKitchenStock(svc,owner,()=>true,true)).status,'ready');
 assert.equal(calls,1);
});
test('late account switch and malformed reply fail closed',async()=>{
 let current=true;
 const svc:KitchenStockReadServices={
  authenticateOwner:async()=>{current=false;},
  rpc:async()=>({data:value(),error:null}),
 };
 assert.deepEqual(await readOwnedKitchenStock(svc,owner,()=>current,true),{status:'unavailable'});
 const broken:KitchenStockReadServices={
  authenticateOwner:async()=>{},
  rpc:async()=>({data:{...value(),ownerId:'other'},error:null}),
 };
 assert.deepEqual(await readOwnedKitchenStock(broken,owner,()=>true,true),{status:'unavailable'});
});
