import test from 'node:test';
import assert from 'node:assert/strict';
import { todayFoodLog, type FuelLogEntry } from './todayFoodLog.ts';

const day='2026-11-11', ownerId='account-a';
const entry:FuelLogEntry={id:'one',ownerId,athleteLocalDate:day,label:'Oatmeal',meal:'breakfast',createdAt:'2026-11-11T12:00:00Z'};
const run=(entries:FuelLogEntry[],owner=ownerId,selectedDay=day)=>
  todayFoodLog({status:'ready',ownerId,athleteLocalDate:day,sourceRevision:'revision-1',entries},owner,selectedDay);

test('unavailable food logs are never presented as known empty',()=>{
  for(const status of ['loading','unavailable','error'] as const) {
    const view=todayFoodLog({status},ownerId,day);
    assert.equal(view.status,'unavailable');
    assert.match(view.detail,/not been loaded/);
  }
});
test('verified empty food day is distinguished from unknown',()=>{
  const result=run([]);
  assert.equal(result.status,'ready');
  assert.match(result.detail,/No food entries/);
});
test('show at most two recent rows, compact without duplicated calories',()=>{
  const rows=[
    entry,
    {...entry,id:'two',label:'Chicken bowl',meal:'lunch' as const,createdAt:'2026-11-11T16:00:00Z'},
    {...entry,id:'three',label:'Apple',meal:'snack' as const,createdAt:'2026-11-11T18:00:00Z'},
  ];
  const result=run(rows);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.visible.map(r=>r.id),['three','two']);
  assert.equal(result.additionalCount,1);
});
test('cross-owner or wrong-day results cannot leak',()=>{
  assert.equal(run([entry],'account-b').status,'unavailable');
  assert.equal(run([entry],ownerId,'2026-11-10').status,'unavailable');
  assert.equal(run([{...entry,ownerId:'account-b'}]).status,'unavailable');
  assert.equal(run([{...entry,athleteLocalDate:'2026-11-10'}]).status,'unavailable');
});
test('invalid/duplicate records fail closed',()=>{
  assert.equal(run([entry,entry]).status,'unavailable');
  assert.equal(run([{...entry,label:' '}]).status,'unavailable');
  assert.equal(run([{...entry,meal:'bad' as FuelLogEntry['meal']}]).status,'unavailable');
  assert.equal(run([{...entry,createdAt:'invalid'}]).status,'unavailable');
});
test('does not display a partially unverified list',()=>{
  const good={status:'ready' as const,ownerId,athleteLocalDate:day,sourceRevision:'',entries:[entry]};
  assert.equal(todayFoodLog(good,ownerId,day).status,'unavailable');
});
