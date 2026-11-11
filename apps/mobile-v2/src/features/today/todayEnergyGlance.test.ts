import test from 'node:test';
import assert from 'node:assert/strict';
import { todayEnergyGlance, type DailyEnergySnapshot } from './todayEnergyGlance.ts';

const day='2026-11-11', ownerId='owner-a', now=new Date('2026-11-11T19:00:00Z');
const snapshot:DailyEnergySnapshot = {
  ownerId, athleteLocalDate:day, sourceRevision:'fuel-v3',
  calculatedAt:'2026-11-11T18:00:00Z',
  burnedCalories:500,eatenCalories:1800,remainingCalories:250,
};
const run=(value:DailyEnergySnapshot=snapshot,selectedOwner=ownerId,selectedDay=day)=>
  todayEnergyGlance({status:'ready',snapshot:value},selectedOwner,selectedDay,now);

test('missing evidence is unknown, not a zero calorie day',()=>{
 for(const status of ['unavailable','loading','error'] as const){
  const result=todayEnergyGlance({status},ownerId,day,now);
  assert.equal(result.status,'unavailable');
  assert.equal(result.eaten,'—');
 }
});
test('verified snapshot uses canonical remaining number, not recalculated',()=>{
 const result=run();
 assert.equal(result.status,'ready');
 assert.equal(result.burned,'500');
 assert.equal(result.eaten,'1,800');
 assert.equal(result.remaining,'250');
 assert.equal(result.sourceRevision,'fuel-v3');
});
test('partially verified totals show dash rather than zero',()=>{
 const result=run({...snapshot,burnedCalories:null,remainingCalories:null,eatenCalories:0});
 assert.equal(result.status,'partial');
 assert.equal(result.burned,'—');
 assert.equal(result.eaten,'0');
 assert.equal(result.remaining,'—');
});
test('cross-owner and other-day snapshot cannot appear',()=>{
 assert.equal(run(snapshot,'owner-b').status,'unavailable');
 assert.equal(run(snapshot,ownerId,'2026-11-10').status,'unavailable');
 assert.equal(run(snapshot,ownerId,'2026-02-30').status,'unavailable');
});
test('bad revision or invalid totals cannot be shown',()=>{
 assert.equal(run({...snapshot,sourceRevision:''}).status,'unavailable');
 assert.equal(run({...snapshot,eatenCalories:NaN}).status,'unavailable');
 assert.equal(run({...snapshot,burnedCalories:-1}).status,'unavailable');
 assert.equal(run({...snapshot,eatenCalories:-20}).status,'unavailable');
 assert.equal(run({...snapshot,remainingCalories:-350}).status,'ready');
});
test('old snapshot becomes stale and hides numbers',()=>{
 const result=run({...snapshot,calculatedAt:'2026-11-09T00:00:00Z'});
 assert.equal(result.status,'stale');
 assert.equal(result.remaining,'—');
});
test('malformed or far-future timestamp cannot certify current totals',()=>{
 assert.equal(run({...snapshot,calculatedAt:'invalid'}).status,'unavailable');
 assert.equal(run({...snapshot,calculatedAt:'2026-11-11T21:00:00Z'}).status,'unavailable');
});
test('no owner never exposes cached data',()=>{
 assert.equal(run(snapshot,'').status,'unavailable');
});
