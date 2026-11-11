import test from 'node:test';
import assert from 'node:assert/strict';
import {todayFuelDestination,parseFuelDayContext,fuelContextDescription} from './todayFuelNavigation.ts';

test('Today daily link preserves exact local date and Daily Extended intent',()=>{
  assert.deepEqual(todayFuelDestination('2026-11-11','daily'),{
    pathname:'/fuel',params:{date:'2026-11-11',section:'daily'},
  });
});
test('Food Log link preserves same day with independent destination intent',()=>{
  assert.deepEqual(todayFuelDestination('2026-11-11','food-log'),{
    pathname:'/fuel',params:{date:'2026-11-11',section:'food-log'},
  });
});
test('invalid local days do not create misleading day links',()=>{
  for(const date of [null,'2026-02-30','2026-11-31','not-a-date']) {
    assert.equal(todayFuelDestination(date,'daily'),null);
  }
});
test('Fuel safely parses exact-date and section query, rejecting arrays and invalid values',()=>{
  assert.deepEqual(parseFuelDayContext('2026-11-11','daily'),{date:'2026-11-11',section:'daily'});
  assert.deepEqual(parseFuelDayContext('2026-11-11','food-log'),{date:'2026-11-11',section:'food-log'});
  assert.equal(parseFuelDayContext(['2026-11-11'],'daily'),null);
  assert.equal(parseFuelDayContext('2026-11-11',['daily']),null);
  assert.equal(parseFuelDayContext('2026-11-11','other'),null);
  assert.equal(parseFuelDayContext('2026-02-30','daily'),null);
});
test('a contextual Fuel placeholder never claims logged or empty data',()=>{
  assert.match(fuelContextDescription({date:'2026-11-11',section:'daily'})??'',/not connected/);
  assert.match(fuelContextDescription({date:'2026-11-11',section:'food-log'})??'',/not connected/);
  assert.equal(fuelContextDescription(null),null);
});
