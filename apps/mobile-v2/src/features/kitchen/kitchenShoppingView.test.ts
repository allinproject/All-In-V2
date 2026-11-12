import test from 'node:test';
import assert from 'node:assert/strict';
import {composeKitchenShoppingView,type VerifiedManualShoppingSnapshot} from './kitchenShoppingView.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row=(id:string,quantity:number,state:'needed'|'in_cart'='needed')=>({
 id,ownerId:owner,description:'Extra bananas',foodId:'banana',
 preparationState:'as_sold',unit:'each',requestedQuantity:quantity,state,version:1,
});
const snapshot=(lines:VerifiedManualShoppingSnapshot['lines']):VerifiedManualShoppingSnapshot=>({
 ownerId:owner,complete:true,revision:'reviewed-r1',lines,
});
const planned=[{foodId:'banana',preparationState:'as_sold',unit:'each',
 required:5,available:2,shortage:3,occurrenceIds:['monday','tuesday','wednesday']}];
test('derived banana shortage and manual extras aggregate with both sources preserved',()=>{
 const result=composeKitchenShoppingView({ownerId:owner,manual:snapshot([row('extra',2)]),
 plannedShortages:planned,unresolvedPlan:[]});
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].quantity,5);
 assert.deepEqual(result.rows[0].manualLineIds,['extra']);
 assert.deepEqual(result.rows[0].plannedOccurrenceIds,['monday','tuesday','wednesday']);
});
test('removing a planned lunch never removes manual extra shopping',()=>{
 const args={ownerId:owner,manual:snapshot([row('extra',2)]),unresolvedPlan:[]};
 const before=composeKitchenShoppingView({...args,plannedShortages:planned});
 const after=composeKitchenShoppingView({...args,plannedShortages:[]});
 assert.equal(before.rows[0].quantity,5);
 assert.equal(after.rows[0].quantity,2);
 assert.deepEqual(after.rows[0].manualLineIds,['extra']);
});
test('in cart is not an approved purchase and stays independent from projected shortage',()=>{
 const x=composeKitchenShoppingView({ownerId:owner,
 manual:snapshot([row('extra',2,'in_cart')]),plannedShortages:planned,unresolvedPlan:[]});
 assert.equal(x.rows.length,2);
 assert.equal(x.rows.find(v=>v.state==='needed')?.quantity,3);
 assert.equal(x.rows.find(v=>v.state==='in_cart')?.quantity,2);
});
test('uncertain manual item stays visible for review instead of vanishing',()=>{
 const draft={...row('unknown',2),foodId:null,preparationState:null,unit:null,requestedQuantity:null};
 const x=composeKitchenShoppingView({ownerId:owner,
  manual:snapshot([draft]),plannedShortages:[],unresolvedPlan:[]});
 assert.equal(x.rows.length,0);
 assert.equal(x.unresolvedManual[0].id,'unknown');
});
test('cross-account, partial and malformed Shopping evidence fails closed',()=>{
 const args={ownerId:owner,manual:snapshot([row('extra',2)]),
 plannedShortages:planned,unresolvedPlan:[]};
 assert.throws(()=>composeKitchenShoppingView({...args,manual:{...args.manual,complete:false as true}}),/Complete/);
 assert.throws(()=>composeKitchenShoppingView({...args,manual:snapshot([{...row('extra',2),ownerId:'other'}])}),/foreign/);
 assert.throws(()=>composeKitchenShoppingView({...args,manual:snapshot([row('extra',2),row('extra',2)])}),/foreign/);
 assert.throws(()=>composeKitchenShoppingView({...args,plannedShortages:[{...planned[0],shortage:0}]}),/Incomplete/);
});
