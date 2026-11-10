import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRacePlanCalendar,assertRacePlanCalendarAssigned,adaptRemainingPlanAfterMiss,type DatedTrainingSession} from './trainingPlanLifecycle.ts';
const intent=(priority:'competition'|'key'|'supporting'|'optional'='supporting')=>({id:'run',sport:'running' as const,label:'Run',purpose:'Training',priority,intensity:'easy' as const,durationMinutes:45,demand:{aerobic:'moderate' as const,mechanicalImpact:'moderate' as const,localMuscular:'low' as const,technicalSkill:'not_applicable' as const},stressTags:['run_impact'],evidenceRefs:['fixture']});
test('36-week race horizon contains every date from user-selected start through race day',()=>{const c=buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2027-07-19'});assert.equal(c.totalWeeks,36);assert.equal(c.days[0].date,'2026-11-09');assert.equal(c.days.at(-1)?.date,'2027-07-19');assert.equal(c.days.length,253);assert.equal(c.days.filter(d=>d.isRaceDay).length,1);assert.equal(c.days[0].phase,'review_required')});
test('calendar starts on the selected date, not silently on Monday',()=>{const c=buildRacePlanCalendar({startDate:'2026-11-11',raceDate:'2027-03-13'});assert.equal(c.days[0].date,'2026-11-11');assert.equal(c.days[0].day,'wednesday');assert.ok(!c.days.some(d=>d.date<'2026-11-11'))});
test('invalid or overlong race horizons fail closed',()=>{assert.throws(()=>buildRacePlanCalendar({startDate:'2026-02-30',raceDate:'2026-11-01'}));assert.throws(()=>buildRacePlanCalendar({startDate:'2026-01-01',raceDate:'2032-01-01'}))});
const sessions:DatedTrainingSession[]=[{id:'long-1',date:'2026-11-08',intent:intent('key'),status:'completed'},{id:'missed-gym',date:'2026-11-09',intent:{...intent('supporting'),id:'strength',sport:'strength' as const},status:'planned'},{id:'quality-2',date:'2026-11-11',intent:intent('key'),status:'planned'},{id:'race',date:'2027-03-13',intent:intent('competition'),status:'planned'}];
test('missed gym is marked skipped and not moved into another day; future key and race remain',()=>{const p=adaptRemainingPlanAfterMiss({today:'2026-11-09',missedSessionId:'missed-gym',reason:'gym_unavailable',sessions,raceDate:'2027-03-13'});assert.equal(p.status,'review_required');assert.equal(p.sessions.find(s=>s.id==='missed-gym')?.status,'skipped');assert.equal(p.sessions.filter(s=>s.id==='missed-gym').length,1);assert.equal(p.sessions.find(s=>s.id==='quality-2')?.date,'2026-11-11');assert.equal(p.sessions.find(s=>s.id==='race')?.date,'2027-03-13');assert.equal(p.invariants.missedWorkNotAutomaticallyRescheduled,true)});
test('completed history cannot be rewritten as missed',()=>{const p=adaptRemainingPlanAfterMiss({today:'2026-11-09',missedSessionId:'long-1',reason:'other',sessions,raceDate:'2027-03-13'});assert.equal(p.status,'blocked');assert.equal(p.sessions.find(s=>s.id==='long-1')?.status,'completed')});
test('missed run from fatigue triggers whole-plan recovery review, not makeup volume',()=>{const p=adaptRemainingPlanAfterMiss({today:'2026-11-09',missedSessionId:'missed-gym',reason:'fatigue',sessions,raceDate:'2027-03-13'});assert.ok(p.recommendations.some(x=>x.includes('recovery')));assert.ok(p.recommendations.some(x=>x.includes('do not move'))||p.recommendations.some(x=>x.includes('do not move the same workout')))});

test('an accepted complete horizon requires every date classified and race day exactly once',()=>{const dates=buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2026-11-23'});assert.throws(()=>assertRacePlanCalendarAssigned(dates));const states=Object.fromEntries(dates.days.map(d=>[d.date,d.isRaceDay?'race' as const:'rest' as const]));const assigned=buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2026-11-23',dayStates:states});assert.doesNotThrow(()=>assertRacePlanCalendarAssigned(assigned))});
test('a race calendar cannot mark an earlier date as race day',()=>{assert.throws(()=>buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2026-11-23',dayStates:{'2026-11-10':'race'}}))});

test('missed-session adaptation fails closed if the canonical race-day commitment is missing',()=>{const noRace=sessions.filter(s=>s.id!=='race');const p=adaptRemainingPlanAfterMiss({today:'2026-11-09',missedSessionId:'missed-gym',reason:'gym_unavailable',sessions:noRace,raceDate:'2027-03-13'});assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='RACE_DATE_PROTECTED'))});
test('malformed dates in the accepted plan cannot be silently ignored during adaptation',()=>{const bad=[...sessions,{...sessions[1],id:'bad-date',date:'not-a-date'}];assert.throws(()=>adaptRemainingPlanAfterMiss({today:'2026-11-09',missedSessionId:'missed-gym',reason:'other',sessions:bad,raceDate:'2027-03-13'}))});

test('race plan acceptance rejects missing, duplicated and swapped days inside the horizon',()=>{
 const dates=buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2026-11-23'});
 const states=Object.fromEntries(dates.days.map(d=>[d.date,d.isRaceDay?'race' as const:'rest' as const]));
 const accepted=buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2026-11-23',dayStates:states});
 assert.doesNotThrow(()=>assertRacePlanCalendarAssigned(accepted));
 const removed={...accepted,days:accepted.days.filter(d=>d.date!=='2026-11-15')};
 assert.throws(()=>assertRacePlanCalendarAssigned(removed),/contiguous/);
 const duplicated={...accepted,days:[...accepted.days]};
 duplicated.days[6]=duplicated.days[5];
 assert.throws(()=>assertRacePlanCalendarAssigned(duplicated),/contiguous/);
 const wrongRaceFlag={...accepted,days:accepted.days.map(d=>({...d}))};
 wrongRaceFlag.days[2].isRaceDay=true;
 assert.throws(()=>assertRacePlanCalendarAssigned(wrongRaceFlag),/contiguous/);
});

test('malformed maxWeeks cannot disable race planning horizon limits',()=>{
 assert.throws(()=>buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2036-11-09',maxWeeks:Number.NaN}),/planning limit/);
 assert.throws(()=>buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2027-11-09',maxWeeks:0}),/planning limit/);
 assert.throws(()=>buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2027-11-09',maxWeeks:2.5}),/planning limit/);
 assert.throws(()=>buildRacePlanCalendar({startDate:'2026-11-09',raceDate:'2036-11-09',maxWeeks:9999}),/planning window/);
});
