import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCanonicalPlanDayMarkers,type CanonicalPlanDay} from './canonicalPlanDayMarkers.ts';
import {monthDayMarkerSummary} from './calendarDayView.ts';
const day=(date:string,state:CanonicalPlanDay['dayState']):CanonicalPlanDay=>({
 id:'day-'+date,ownerId:'owner-A',planRevisionId:'rev-2',athleteLocalDate:date,dayState:state,
});
const project=(days:CanonicalPlanDay[])=>projectCanonicalPlanDayMarkers({
 expectedOwnerId:'owner-A',activePlanRevisionId:'rev-2',complete:true,raceDate:'2026-11-15',days,
});
test('only explicit non-workout day statuses emit day markers; planned day adds no fictitious workout',()=>{
 const result=project([day('2026-11-10','planned'),day('2026-11-11','rest'),day('2026-11-12','recovery'),
  day('2026-11-13','unavailable'),day('2026-11-14','review_required'),day('2026-11-15','race')]);
 assert.deepEqual(result.map(x=>x.status),['rest','recovery','unavailable','review_required','race']);
 const summary=monthDayMarkerSummary({status:'ready',records:result},'2026-11-13');
 assert.deepEqual(summary.visible.map(x=>x.kind),['unavailable']);
 assert.equal(result.some(x=>x.status==='completed'||x.status==='missed'),false);
});
test('wrong owner, stale revision, duplicate date, incomplete snapshot fail closed',()=>{
 assert.throws(()=>project([{...day('2026-11-10','rest'),ownerId:'owner-B'}]),/Invalid, foreign/);
 assert.throws(()=>project([{...day('2026-11-10','rest'),planRevisionId:'rev-1'}]),/Invalid, foreign/);
 assert.throws(()=>project([day('2026-11-10','rest'),day('2026-11-10','planned')]),/Invalid, foreign/);
 assert.throws(()=>projectCanonicalPlanDayMarkers({
  expectedOwnerId:'owner-A',activePlanRevisionId:'rev-2',complete:false,raceDate:null,days:[],
 }),/Complete current-plan/);
});
test('a race-state day cannot be inferred from a different date',()=>{
 assert.throws(()=>project([day('2026-11-14','race')]),/exact goal race/);
});
test('missed/cancelled are execution lifecycle states, never inferred from plan day',()=>{
 assert.throws(()=>project([day('2026-11-10','missed' as CanonicalPlanDay['dayState'])]),/Unsupported/);
});

test('two canonical races appear as separate Training markers with legacy single-race callers intact',()=>{
 const dates=['2027-04-10','2027-06-05'];
 const eventDays=dates.map(date=>({...day(date,'race'),planRevisionId:'rev-2'}));
 const markers=projectCanonicalPlanDayMarkers({
  expectedOwnerId:'owner-A',activePlanRevisionId:'rev-2',complete:true,
  raceDate:null,raceDates:dates,days:eventDays
 });
 assert.deepEqual(markers.map(m=>m.athleteLocalDate),dates);
 assert.ok(markers.every(m=>m.status==='race'));
 assert.deepEqual(monthDayMarkerSummary({status:'ready',records:markers},'2027-04-10').visible.map(m=>m.kind),['race']);
 assert.deepEqual(monthDayMarkerSummary({status:'ready',records:markers},'2027-06-05').visible.map(m=>m.kind),['race']);
 assert.equal(project([day('2026-11-15','race')]).length,1);
});
test('uncertified event dates, duplicate dates and inconsistent single/multiple arguments fail closed',()=>{
 const base={expectedOwnerId:'owner-A',activePlanRevisionId:'rev-2',complete:true,
  raceDate:null,days:[day('2027-04-10','race'),day('2027-06-05','race')]};
 assert.throws(()=>projectCanonicalPlanDayMarkers({...base,raceDates:['2027-04-10']}),/certified exact/);
 assert.throws(()=>projectCanonicalPlanDayMarkers({...base,raceDates:['2027-04-10','2027-04-10']}),/Distinct certified/);
 assert.throws(()=>projectCanonicalPlanDayMarkers({...base,raceDates:['2027-04-10','2027-02-30']}),/Distinct certified/);
 assert.throws(()=>projectCanonicalPlanDayMarkers({...base,raceDate:'2027-06-05',raceDates:['2027-04-10','2027-06-05']}),/Distinct certified/);
 assert.throws(()=>projectCanonicalPlanDayMarkers(base),/certified exact/);
});
