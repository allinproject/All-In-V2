import assert from 'node:assert/strict';
import test from 'node:test';
import {shiftCalendarDate,weekDaysForDate,formatCalendarDay,calendarRecordsForDay,firstOfMonth,shiftCalendarMonth,monthCalendarWeeks,formatCalendarMonth} from './calendarDayView.ts';

test('week begins Monday and crosses month/year boundaries without UTC date drift',()=>{
 assert.deepEqual(weekDaysForDate('2027-01-01'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.equal(shiftCalendarDate('2028-02-28',1),'2028-02-29');
 assert.equal(shiftCalendarDate('2028-02-29',1),'2028-03-01');
 assert.match(formatCalendarDay('2026-11-10'),/Tuesday, November 10, 2026/);
});
test('invalid selected date or unreasonable offset fails closed',()=>{
 assert.deepEqual(weekDaysForDate('2026-02-30'),[]);
 assert.equal(shiftCalendarDate('not-a-date',1),null);
 assert.equal(shiftCalendarDate('2026-11-10',Infinity),null);
});
test('unavailable canonical reads must not be misrepresented as verified empty',()=>{
 assert.equal(calendarRecordsForDay({status:'unavailable'},'2026-11-10'),null);
 assert.equal(calendarRecordsForDay({status:'loading'},'2026-11-10'),null);
 assert.deepEqual(calendarRecordsForDay({status:'ready',records:[]},'2026-11-10'),[]);
});
test('scheduled run and independent manual stair completion remain separate',()=>{
 const records=[
  {id:'run',athleteLocalDate:'2026-11-10',kind:'scheduled',status:'planned'},
  {id:'stair',athleteLocalDate:'2026-11-10',kind:'completed',status:'completed'},
  {id:'walk',athleteLocalDate:'2026-11-11',kind:'completed',status:'completed'},
 ];
 const selected=calendarRecordsForDay({status:'ready',records},'2026-11-10');
 assert.deepEqual(selected?.map(r=>r.id),['run','stair']);
 assert.equal(selected?.[0].status,'planned');
});

test('month overview includes complete Monday-first weeks and adjacent-month context',()=>{
 const weeks=monthCalendarWeeks('2026-11-10');
 // Nov 1, 2026 is Sunday and Nov 30 is Monday: Monday-first grid needs six rows.
 assert.equal(weeks.length,6);
 assert.equal(weeks[0][0],'2026-10-26');
 assert.equal(weeks.at(-1)?.at(-1),'2026-12-06');
 assert.equal(weeks.flat().filter(d=>d.startsWith('2026-11-')).length,30);
 assert.equal(formatCalendarMonth('2026-11-10'),'November 2026');
});
test('month arrows move calendar month, not a fixed number of days',()=>{
 assert.equal(firstOfMonth('2026-11-30'),'2026-11-01');
 assert.equal(shiftCalendarMonth('2026-12-31',1),'2027-01-01');
 assert.equal(shiftCalendarMonth('2027-03-31',-1),'2027-02-01');
 assert.equal(shiftCalendarMonth('2028-02-29',1),'2028-03-01');
 assert.equal(shiftCalendarMonth('invalid',1),null);
});
test('week arrows shift exactly seven days and retain selected weekday',()=>{
 const selected='2026-11-10';
 const next=shiftCalendarDate(selected,7);
 assert.equal(next,'2026-11-17');
 assert.deepEqual(weekDaysForDate(next!),['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22']);
 assert.equal(shiftCalendarDate(next!,-7),selected);
});
