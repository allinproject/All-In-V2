import assert from 'node:assert/strict';
import test from 'node:test';
import {combineCalendarReads,indicatorsForCalendarDay,type PlannedCalendarItem,type CompletedCalendarItem} from './trainingCalendarReadModel.ts';

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
test('explicit link removes planned duplicate without changing completed sport',()=>{
 const x=combineCalendarReads({...input,completed:{...input.completed,records:[{...completed,plannedSessionId:'run-1'}]}});
 assert.deepEqual(indicatorsForCalendarDay(x,'2026-11-10').visible.map(m=>[m.kind,m.status]),[['stair','completed']]);
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
