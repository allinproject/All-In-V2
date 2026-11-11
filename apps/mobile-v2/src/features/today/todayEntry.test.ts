import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceLocalToday, todayTrainingDestination, todayActivitiesForDate, shouldRefreshTodayOnAppState, millisecondsUntilNextLocalDay } from './todayEntry.ts';

test('device date uses local day, not UTC conversion', () => {
  assert.equal(deviceLocalToday(new Date(2026,10,11,23,59,59)), '2026-11-11');
  assert.equal(deviceLocalToday(new Date(Number.NaN)),null);
});
test('Today to Train selects the exact date',()=>{
  assert.deepEqual(todayTrainingDestination('2026-11-11'),{pathname:'/train',params:{date:'2026-11-11'}});
  assert.equal(todayTrainingDestination('2026-02-30'),null);
  assert.equal(todayTrainingDestination(null),null);
});
test('unavailable/loading/error are unknown, never inferred rest',()=>{
  for (const status of ['unavailable','loading','error'] as const) {
    assert.equal(todayActivitiesForDate({status},'2026-11-11'),null);
  }
});
test('known empty is different from missing data',()=> {
  assert.deepEqual(todayActivitiesForDate({status:'ready',records:[]},'2026-11-11'),[]);
});
test('verified records filter only to the active day',()=>{
  const records=[{id:'previous',athleteLocalDate:'2026-11-10'},{id:'current',athleteLocalDate:'2026-11-11'}];
  assert.deepEqual(todayActivitiesForDate({status:'ready',records},'2026-11-11'),[records[1]]);
});

test('foreground refreshes the local day without recomputing in background',()=>{
  assert.equal(shouldRefreshTodayOnAppState('active'),true);
  assert.equal(shouldRefreshTodayOnAppState('background'),false);
  assert.equal(shouldRefreshTodayOnAppState('inactive'),false);
  assert.equal(shouldRefreshTodayOnAppState('unknown'),false);
});

test('actively open Today switches at local midnight with a small safe cushion',()=>{
  const now = new Date(2026,10,11,23,59,59,900);
  assert.equal(millisecondsUntilNextLocalDay(now),150);
  const noon = new Date(2026,10,11,12,0,0,0);
  assert.equal(millisecondsUntilNextLocalDay(noon),12*60*60*1000+50);
});
test('next-day timer respects local calendar construction, not fixed 24 hours',()=>{
  const now = new Date(2026,2,8,0,0,0,0);
  const tomorrow = new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
  assert.equal(millisecondsUntilNextLocalDay(now),tomorrow.getTime()-now.getTime()+50);
  assert.equal(millisecondsUntilNextLocalDay(new Date(NaN)),null);
});
