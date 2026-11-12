import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOwnedKitchenStock,readOwnedKitchenStock,writeOwnedManualShopping,confirmOwnedKitchenPurchase,type KitchenStockReadServices} from './kitchenStockOwnerClient.ts';
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

test('manual Shopping writer stays disabled and uses canonical owner RPC on confirmation',async()=>{
 const calls:string[]=[];
 const svc:KitchenStockReadServices={
  authenticateOwner:async()=>{},
  rpc:async(name)=>{calls.push(name);return {data:2,error:null}},
 };
 const draft={lineId:'33333333-3333-4333-8333-333333333333',
  actionId:'44444444-4444-4444-8444-444444444444',
  expectedVersion:1,description:'Bananas',foodId:'banana',
  preparationState:'as_sold',unit:'each',quantity:3,state:'in_cart' as const};
 assert.equal((await writeOwnedManualShopping(svc,owner,draft,()=>true,false)).status,'disabled');
 assert.equal(calls.length,0);
 assert.deepEqual(await writeOwnedManualShopping(svc,owner,draft,()=>true,true),
  {status:'saved',version:2});
 assert.deepEqual(calls,['v2_kitchen_write_manual_shopping']);
 assert.equal((await writeOwnedManualShopping(svc,owner,{...draft,quantity:-1},()=>true,true)).status,'invalid');
 assert.equal(calls.length,1);
});
test('reviewed multi-line purchase requires exact source, stable IDs and verified result',async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const receiptId='55555555-5555-4555-8555-555555555555';
 const actionId='66666666-6666-4666-8666-666666666666';
 const lines=[{lineId:'77777777-7777-4777-8777-777777777777',
  lotId:'88888888-8888-4888-8888-888888888888',
  foodId:'apple',preparationState:'as_sold',unit:'each',
  stockLocation:'fridge' as const,quantity:4,expectedLotVersion:0,expiryDate:null}];
 const svc:KitchenStockReadServices={
  authenticateOwner:async()=>{},
  rpc:async(name,args)=>{calls.push({name,args});return {data:receiptId,error:null}},
 };
 assert.equal((await confirmOwnedKitchenPurchase(svc,owner,receiptId,actionId,lines,()=>true,false)).status,'disabled');
 assert.deepEqual(await confirmOwnedKitchenPurchase(svc,owner,receiptId,actionId,lines,()=>true,true),
  {status:'saved',receiptId});
 assert.equal(calls[0].name,'v2_kitchen_confirm_purchase');
 assert.deepEqual(calls[0].args.p_lines,lines);
 assert.equal((await confirmOwnedKitchenPurchase(svc,owner,receiptId,actionId,[lines[0],lines[0]],()=>true,true)).status,'invalid');
 assert.equal((await confirmOwnedKitchenPurchase(svc,owner,receiptId,actionId,[{...lines[0],quantity:0}],()=>true,true)).status,'invalid');
 assert.equal(calls.length,1);
});
test('conflict, unauthorized and ambiguous receipt results never claim saved',async()=>{
 const receiptId='99999999-9999-4999-8999-999999999999';
 const actionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const lines=[{lineId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  lotId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  foodId:'apple',preparationState:'as_sold',unit:'each',
  stockLocation:'pantry' as const,quantity:1,expectedLotVersion:0,expiryDate:null}];
 const service=(error:{code:string}|null,data:unknown):KitchenStockReadServices=>({
  authenticateOwner:async()=>{},rpc:async()=>({data,error}),
 });
 assert.equal((await confirmOwnedKitchenPurchase(service({code:'40001'},null),
  owner,receiptId,actionId,lines,()=>true,true)).status,'conflict');
 assert.equal((await confirmOwnedKitchenPurchase(service({code:'42501'},null),
  owner,receiptId,actionId,lines,()=>true,true)).status,'unauthorized');
 assert.equal((await confirmOwnedKitchenPurchase(service(null,'different'),
  owner,receiptId,actionId,lines,()=>true,true)).status,'unavailable');
});
