import test from 'node:test';
import assert from 'node:assert/strict';
import { combineCalendarReads, type PlannedCalendarItem, type CompletedCalendarItem } from '../training/trainingCalendarReadModel.ts';
import { summarizeTodayTraining } from './todayTrainingCard.ts';

const day='2026-11-11', ownerId='owner-a';
const planned:PlannedCalendarItem={id:'plan-a',ownerId,athleteLocalDate:day,sport:'running',state:'planned',planRevisionId:'rev-1'};
const completed:CompletedCalendarItem={id:'actual-a',ownerId,athleteLocalDate:day,sport:'cycling',source:'recorded',plannedSessionId:null};
const ready=(plans:PlannedCalendarItem[],actuals:CompletedCalendarItem[])=>combineCalendarReads({
  ownerId,fromDate:day,throughDate:day,
  planned:{status:'ready',ownerId,fromDate:day,throughDate:day,records:plans},
  completed:{status:'ready',ownerId,fromDate:day,throughDate:day,records:actuals},
});
test('unknown canonical sources do not invent a plan or rest day',()=>{
  const r=combineCalendarReads({ownerId,fromDate:day,throughDate:day,planned:{status:'unavailable'},completed:{status:'unavailable'}});
  const card=summarizeTodayTraining(r,day);
  assert.equal(card.status,'unavailable');
  assert.match(card.title,/not connected/);
});
test('one scheduled workout remains scheduled alongside unrelated completed ride',()=>{
  const card=summarizeTodayTraining(ready([planned],[completed]),day);
  assert.equal(card.status,'ready');
  assert.match(card.title,/1 workout scheduled/);
  assert.match(card.detail,/1 completed activity/);
});
test('linked completion appears once as completed, not still scheduled',()=>{
  const actual={...completed,sport:'running' as const,plannedSessionId:'plan-a'};
  const card=summarizeTodayTraining(ready([planned],[actual]),day);
  assert.equal(card.title,'1 activity completed');
});
test('verified empty is not interpreted as rest',()=>{
  const card=summarizeTodayTraining(ready([],[]),day);
  assert.equal(card.status,'ready');
  assert.equal(card.title,'No workouts scheduled today');
  assert.doesNotMatch(card.title,/rest/i);
});
test('explicit rest and recovery keep plan provenance',()=>{
  const rest={...planned,sport:'rest' as const,state:'rest' as const};
  assert.equal(summarizeTodayTraining(ready([rest],[]),day).title,'Planned rest day');
  const recovery={...planned,id:'recovery',sport:'recovery' as const,state:'recovery' as const};
  assert.equal(summarizeTodayTraining(ready([recovery],[]),day).title,'Recovery planned');
});
test('partial planned read still shows planned sessions without fabricating completions',()=>{
  const r=combineCalendarReads({ownerId,fromDate:day,throughDate:day,
    planned:{status:'ready',ownerId,fromDate:day,throughDate:day,records:[planned]},
    completed:{status:'unavailable'},
  });
  const card=summarizeTodayTraining(r,day);
  assert.equal(card.status,'partial');
  assert.match(card.detail,/unavailable/);
});
test('partial completed read never implies no scheduled workouts',()=>{
  const r=combineCalendarReads({ownerId,fromDate:day,throughDate:day,
    planned:{status:'unavailable'},
    completed:{status:'ready',ownerId,fromDate:day,throughDate:day,records:[completed]},
  });
  const card=summarizeTodayTraining(r,day);
  assert.equal(card.status,'partial');
  assert.match(card.detail,/schedule is unavailable/);
});
test('other owner or invalid range cannot certify a Today workout',()=>{
  const r=combineCalendarReads({ownerId,fromDate:day,throughDate:day,
    planned:{status:'ready',ownerId:'owner-b',fromDate:day,throughDate:day,records:[{...planned,ownerId:'owner-b'}]},
    completed:{status:'unavailable'},
  });
  assert.equal(summarizeTodayTraining(r,day).status,'unavailable');
  assert.equal(summarizeTodayTraining(ready([planned],[]),'invalid').status,'unavailable');
});

test('verified empty completed read with missing plan remains partial, not an empty training day',()=>{
  const r=combineCalendarReads({ownerId,fromDate:day,throughDate:day,
    planned:{status:'unavailable'},
    completed:{status:'ready',ownerId,fromDate:day,throughDate:day,records:[]},
  });
  const card=summarizeTodayTraining(r,day);
  assert.equal(card.status,'partial');
  assert.equal(card.title,'Training schedule unavailable');
  assert.match(card.detail,/Completed activities were checked/);
  assert.match(card.detail,/No rest day/);
});
