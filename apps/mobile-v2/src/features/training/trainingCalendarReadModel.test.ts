import assert from 'node:assert/strict';
import test from 'node:test';
import {combineCalendarReads,indicatorsForCalendarDay,calendarDaySections,type PlannedCalendarItem,type CompletedCalendarItem} from './trainingCalendarReadModel.ts';

const planned:PlannedCalendarItem={id:'run-1',ownerId:'a',athleteLocalDate:'2026-11-10',sport:'running',state:'planned',planRevisionId:'revision-1'};
const completed:CompletedCalendarItem={id:'stair-1',ownerId:'a',athleteLocalDate:'2026-11-10',sport:'stair',source:'manual_entry',plannedSessionId:null};
const input={
 ownerId:'a',fromDate:'2026-11-01',throughDate:'2026-11-30',
 planned:{status:'ready' as const,ownerId:'a',fromDate:'2026-11-01',throughDate:'2026-11-30',records:[planned]},
 completed:{status:'ready' as const,ownerId:'a',fromDate:'2026-11-01',throughDate:'2026-11-30',records:[completed]},
};
test('independent actual stair completion preserves planned run in same day',()=>{
 const x=combineCalendarReads(input);
 assert.equal(x.status,'ready');
 assert.deepEqual(indicatorsForCalendarDay(x,'2026-11-10').visible.map(m=>[m.kind,m.status]),
   [['running','planned'],['stair','completed']]);
});
test('a matching planned completion renders once, without hiding a different sport',()=>{
 const actual={...completed,id:'run-actual',sport:'running' as const,plannedSessionId:'run-1'};
 const x=combineCalendarReads({...input,completed:{...input.completed,records:[actual]}});
 assert.equal(x.status,'ready');
 assert.deepEqual(indicatorsForCalendarDay(x,'2026-11-10').visible.map(m=>[m.kind,m.status]),[['running','completed']]);
});
test('a mistaken stair-to-run plan link must not hide the scheduled run',()=>{
 const x=combineCalendarReads({...input,completed:{...input.completed,records:[{...completed,plannedSessionId:'run-1'}]}});
 assert.equal(x.status,'partial');
 assert.equal(x.planned.status,'ready');
 assert.equal(x.completed.status,'unavailable');
 assert.equal(x.markers.status,'unavailable');
});
test('cross-date linked activity cannot erase the planned date without a plan revision',()=>{
 const later={...completed,id:'run-actual',sport:'running' as const,athleteLocalDate:'2026-11-12',plannedSessionId:'run-1'};
 const x=combineCalendarReads({...input,completed:{...input.completed,records:[later]}});
 assert.equal(x.status,'ready');
 assert.deepEqual(indicatorsForCalendarDay(x,'2026-11-10').visible.map(m=>[m.kind,m.status]),[['running','planned']]);
 assert.deepEqual(indicatorsForCalendarDay(x,'2026-11-12').visible.map(m=>[m.kind,m.status]),[['running','completed']]);
});
test('duplicate completion links never certify a complete day',()=>{
 const c={...completed,id:'run-actual',sport:'running' as const,plannedSessionId:'run-1'};
 const d={...c,id:'run-actual-again'};
 const x=combineCalendarReads({...input,completed:{...input.completed,records:[c,d]}});
 assert.equal(x.status,'partial');
 assert.equal(x.markers.status,'unavailable');
});
test('cancelled or recovery planned events cannot be completed by a linked workout',()=>{
 const x=combineCalendarReads({...input,planned:{...input.planned,records:[{...planned,state:'cancelled' as const}]},
   completed:{...input.completed,records:[{...completed,id:'completed-run',sport:'running' as const,plannedSessionId:'run-1'}]}});
 assert.equal(x.status,'partial');
 assert.equal(x.markers.status,'unavailable');
});
test('an explicitly missed plan cannot be silently converted to completed by an inconsistent link',()=>{
 const actual={...completed,id:'completed-run',sport:'running' as const,plannedSessionId:'run-1'};
 const x=combineCalendarReads({...input,planned:{...input.planned,records:[{...planned,state:'missed' as const}]},
   completed:{...input.completed,records:[actual]}});
 assert.equal(x.status,'partial');
 assert.equal(x.planned.status,'ready');
 assert.equal(x.completed.status,'unavailable');
 assert.equal(x.markers.status,'unavailable');
});
test('partial reads cannot claim complete markers or interpret silence as rest',()=>{
 const x=combineCalendarReads({...input,completed:{status:'unavailable' as const}});
 assert.equal(x.status,'partial');
 assert.equal(indicatorsForCalendarDay(x,'2026-11-10').kind,'unavailable');
 const y=combineCalendarReads({...input,planned:{...input.planned,records:[]},completed:{...input.completed,records:[]}});
 assert.equal(y.status,'ready');
 assert.deepEqual(indicatorsForCalendarDay(y,'2026-11-10').visible,[]);
});
test('out-of-range, cross-owner, malformed, and duplicate reads refuse certification',()=>{
 for(const bad of [
   {...input.planned,ownerId:'b'},
   {...input.planned,fromDate:'2026-11-05'},
   {...input.planned,records:[{...planned,ownerId:'b'}]},
   {...input.planned,records:[planned,planned]},
   {...input.planned,records:[{...planned,state:'missed' as const,athleteLocalDate:'2026-12-10'}]},
 ]) {
  const x=combineCalendarReads({...input,planned:bad});
  assert.equal(x.status,'partial');
  assert.equal(x.markers.status,'unavailable');
 }
});
test('only explicit missed, rest, and recovery records produce those labels',()=>{
 const x=combineCalendarReads({...input,planned:{...input.planned,records:[
  {...planned,state:'missed' as const,athleteLocalDate:'2026-11-04'},
  {...planned,id:'rest',sport:'rest' as const,state:'rest' as const,athleteLocalDate:'2026-11-05'},
  {...planned,id:'recovery',sport:'recovery' as const,state:'recovery' as const,athleteLocalDate:'2026-11-06'},
 ]}});
 assert.equal(x.status,'ready');
 assert.deepEqual(['2026-11-04','2026-11-05','2026-11-06'].map(day=>indicatorsForCalendarDay(x,day).visible[0]?.status),
 ['missed','rest','recovery']);
});

test('selected day separates the scheduled run from independent stair completion',()=>{
 const sections=calendarDaySections(combineCalendarReads(input),'2026-11-10');
 assert.equal(sections.scheduled.status,'ready');
 assert.equal(sections.completed.status,'ready');
 if(sections.scheduled.status==='ready'&&sections.completed.status==='ready'){
  assert.deepEqual(sections.scheduled.records.map(r=>r.id),['run-1']);
  assert.deepEqual(sections.completed.records.map(r=>r.id),['stair-1']);
 }
});
test('linked completed run shows only in completed section for that day',()=>{
 const actual={...completed,id:'run-actual',sport:'running' as const,plannedSessionId:'run-1'};
 const x=calendarDaySections(combineCalendarReads({...input,completed:{...input.completed,records:[actual]}}),'2026-11-10');
 assert.equal(x.scheduled.status,'ready');
 assert.equal(x.completed.status,'ready');
 if(x.scheduled.status==='ready'&&x.completed.status==='ready'){
  assert.equal(x.scheduled.records.length,0);
  assert.deepEqual(x.completed.records.map(r=>r.id),['run-actual']);
 }
});
test('cross-date linked run remains scheduled on original day and completed on actual day',()=>{
 const later={...completed,id:'run-actual',sport:'running' as const,athleteLocalDate:'2026-11-12',plannedSessionId:'run-1'};
 const combined=combineCalendarReads({...input,completed:{...input.completed,records:[later]}});
 const original=calendarDaySections(combined,'2026-11-10');
 const actual=calendarDaySections(combined,'2026-11-12');
 assert.equal(original.scheduled.status,'ready');
 if(original.scheduled.status==='ready')assert.deepEqual(original.scheduled.records.map(r=>r.id),['run-1']);
 assert.equal(actual.completed.status,'ready');
 if(actual.completed.status==='ready')assert.deepEqual(actual.completed.records.map(r=>r.id),['run-actual']);
});
test('selected day never interprets unavailable completed read as an empty completed history',()=>{
 const combined=combineCalendarReads({...input,completed:{status:'unavailable' as const}});
 const x=calendarDaySections(combined,'2026-11-10');
 assert.equal(x.scheduled.status,'ready');
 assert.equal(x.completed.status,'unavailable');
 if(x.scheduled.status==='ready')assert.deepEqual(x.scheduled.records.map(r=>r.id),['run-1']);
});
test('selected day omits cancelled schedule but preserves explicit rest and missed records',()=>{
 const combined=combineCalendarReads({...input,planned:{...input.planned,records:[
  {...planned,id:'cancelled',state:'cancelled' as const},
  {...planned,id:'missed',state:'missed' as const},
  {...planned,id:'rest',sport:'rest' as const,state:'rest' as const}
 ]}});
 const x=calendarDaySections(combined,'2026-11-10');
 assert.equal(x.scheduled.status,'ready');
 if(x.scheduled.status==='ready')assert.deepEqual(x.scheduled.records.map(r=>r.id),['missed','rest']);
});
test('invalid selected day does not show source data',()=>{
 const x=calendarDaySections(combineCalendarReads(input),'2026-11-31');
 assert.equal(x.scheduled.status,'unavailable');
 assert.equal(x.completed.status,'unavailable');
});
