import test from 'node:test';
import assert from 'node:assert/strict';
import {todayKitchenDue,type KitchenDueItem} from './todayKitchenDue.ts';

const day='2026-11-11',ownerId='athlete-one';
const item:KitchenDueItem={id:'prep',ownerId,athleteLocalDate:day,kind:'meal_prep',title:'Prepare lunches',status:'due'};
const ready=(items:KitchenDueItem[])=>({status:'ready' as const,ownerId,athleteLocalDate:day,sourceRevision:'kitchen-rev-1',items});
test('unknown is not a due reminder',()=>{
 for(const status of ['unavailable','loading','error'] as const)
  assert.deepEqual(todayKitchenDue({status},ownerId,day),[]);
});
test('due prep and cook reminders display only when source says due',()=>{
 const cook={...item,id:'cook',kind:'cook_now' as const,title:'Cook dinner'};
 assert.deepEqual(todayKitchenDue(ready([item,cook]),ownerId,day),[
  {id:'prep',title:'Prepare lunches',label:'Meal Prep'},
  {id:'cook',title:'Cook dinner',label:'Cook Now'},
 ]);
});
test('completed, cancelled, and scheduled but not due do not appear',()=>{
 assert.deepEqual(todayKitchenDue(ready([{...item,status:'completed'}]),ownerId,day),[]);
 assert.deepEqual(todayKitchenDue(ready([{...item,status:'cancelled'}]),ownerId,day),[]);
});
test('other owner or date cannot produce prompt',()=>{
 assert.deepEqual(todayKitchenDue(ready([item]),'someone-else',day),[]);
 assert.deepEqual(todayKitchenDue(ready([item]),ownerId,'2026-11-12'),[]);
 assert.deepEqual(todayKitchenDue(ready([{...item,ownerId:'someone-else'}]),ownerId,day),[]);
});
test('invalid or duplicated evidence fails closed',()=>{
 assert.deepEqual(todayKitchenDue(ready([item,item]),ownerId,day),[]);
 assert.deepEqual(todayKitchenDue(ready([{...item,title:' '}]),ownerId,day),[]);
 assert.deepEqual(todayKitchenDue({...ready([item]),sourceRevision:''},ownerId,day),[]);
});
test('cap reminders to two contextual items, not a permanent sixth card',()=>{
 const rows=[item,...[2,3].map(n=>({...item,id:String(n)}))];
 assert.equal(todayKitchenDue(ready(rows),ownerId,day).length,2);
});
