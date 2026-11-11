import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMultiEventSeasonPlan,assertMultiEventSeasonAssigned,reviewMultiEventMissedSession,type SeasonEvent} from './multiEventSeasonPlan.ts';
const e=(id:string,date:string,priority:'A'|'B'|'C'='A',demand:'endurance'|'strength'|'mixed'|'unknown'='endurance'):SeasonEvent=>({id,date,name:id,sport:'running',priority,demand});
const events=[e('half','2027-04-10','B'),e('marathon','2027-06-05','A')];
test('a B preparation race and A goal race share an inclusive calendar',()=>{
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events});
 assert.equal(p.days.at(-1)?.date,'2027-06-05');
 assert.deepEqual(p.days.filter(d=>d.isRaceDay).map(d=>d.date),['2027-04-10','2027-06-05']);
 assert.deepEqual(p.days.find(d=>d.date==='2027-04-10')?.eventIds,['half']);
 assert.equal(p.invariants.noAutomaticWrite,true);
});
test('two A races trigger multi-peak review without dropping either event',()=>{
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events:[e('ultra1','2027-06-05'),e('ultra2','2027-09-18')]});
 assert.equal(p.events.length,2);assert.ok(p.issues.some(i=>i.code==='MULTIPLE_A'));
});
test('two close endurance events prompt a recovery conflict review',()=>{
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events:[e('ultra','2027-06-05'),e('marathon','2027-06-19')]});
 assert.ok(p.issues.some(i=>i.code==='RECOVERY_REVIEW'&&i.eventIds.length===2));
});
test('two events on the same date fail closed instead of overwriting one',()=>{
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events:[e('one','2027-05-01'),e('two','2027-05-01','C')]});
 assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='DATE_CONFLICT'));
 assert.throws(()=>assertMultiEventSeasonAssigned(p));
});
test('duplicate IDs and invalid dates cannot be silently accepted',()=>{
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events:[e('same','2027-05-01'),e('same','2027-06-01')]});
 assert.equal(p.status,'blocked');
 assert.throws(()=>buildMultiEventSeasonPlan({startDate:'2027-02-01',events:[e('bad','2027-02-30')]}));
 assert.throws(()=>buildMultiEventSeasonPlan({startDate:'2027-02-01',events:[e('early','2027-01-30')]}));
});
test('full season acceptance requires classified days and protected event states',()=>{
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events});
 assert.throws(()=>assertMultiEventSeasonAssigned(p));
 const states=Object.fromEntries(p.days.map(day=>[day.date,day.isRaceDay?'race' as const:'rest' as const]));
 const assigned=buildMultiEventSeasonPlan({startDate:'2027-02-01',events,dayStates:states});
 assert.doesNotThrow(()=>assertMultiEventSeasonAssigned(assigned));
 assert.throws(()=>buildMultiEventSeasonPlan({startDate:'2027-02-01',events,dayStates:{'2027-03-01':'race'}}));
 assert.throws(()=>buildMultiEventSeasonPlan({startDate:'2027-02-01',events,dayStates:{'2027-04-10':'rest'}}));
});
test('draft creation preserves input order and unknown demands remain unknown',()=>{
 const input=[e('later','2027-07-01'),e('earlier','2027-04-01','C','unknown')];
 const p=buildMultiEventSeasonPlan({startDate:'2027-02-01',events:input});
 assert.equal(input[0].id,'later');assert.equal(p.events[0].id,'earlier');
 assert.ok(p.issues.some(i=>i.code==='DEMAND_UNKNOWN'));
});

const intent=(priority:'competition'|'key'|'supporting')=>({
 id:'run',sport:'running' as const,label:'run',purpose:'Training',priority,intensity:'easy' as const,durationMinutes:45,
 demand:{aerobic:'moderate' as const,mechanicalImpact:'moderate' as const,localMuscular:'low' as const,technicalSkill:'not_applicable' as const},stressTags:['impact'],evidenceRefs:['fixture']
});
const datedSessions=[
 {id:'missed',date:'2027-03-01',status:'planned' as const,intent:intent('supporting')},
 {id:'half-session',date:'2027-04-10',status:'planned' as const,intent:intent('competition')},
 {id:'marathon-session',date:'2027-06-05',status:'planned' as const,intent:intent('competition')}
];
const reflowInput=()=>({
 today:'2027-03-01',missedSessionId:'missed',reason:'schedule_conflict' as const,events,
 sessions:datedSessions,eventSessionIds:{half:'half-session',marathon:'marathon-session'}
});
test('missed training review preserves both earlier and final race sessions',()=>{
 const r=reviewMultiEventMissedSession(reflowInput());
 assert.equal(r.status,'review_required');
 assert.equal(r.proposal?.sessions.find(s=>s.id==='missed')?.status,'skipped');
 assert.equal(r.proposal?.sessions.find(s=>s.id==='half-session')?.date,'2027-04-10');
 assert.equal(r.proposal?.sessions.find(s=>s.id==='marathon-session')?.date,'2027-06-05');
});
test('reflow blocks missing, duplicated or altered canonical event session bindings',()=>{
 const missing=reviewMultiEventMissedSession({...reflowInput(),eventSessionIds:{half:'half-session'}});
 assert.equal(missing.status,'blocked');assert.equal(missing.proposal,null);
 const changed=reviewMultiEventMissedSession({...reflowInput(),sessions:datedSessions.map(s=>s.id==='half-session'?{...s,date:'2027-04-11'}:s)});
 assert.ok(changed.issues.some(i=>i.code==='EVENT_DATE_CHANGED'));
 const duplicate=reviewMultiEventMissedSession({...reflowInput(),eventSessionIds:{half:'half-session',marathon:'half-session'}});
 assert.ok(duplicate.issues.some(i=>i.code==='EVENT_BINDING_MISSING'));
});
test('a missed race or new race-day unavailability is blocked for explicit event review',()=>{
 const raceMiss=reviewMultiEventMissedSession({...reflowInput(),missedSessionId:'half-session'});
 assert.ok(raceMiss.issues.some(i=>i.code==='EVENT_SESSION_MISSED'));assert.equal(raceMiss.proposal,null);
 const unavailable=reviewMultiEventMissedSession({...reflowInput(),newlyUnavailableDates:['2027-04-10']});
 assert.ok(unavailable.issues.some(i=>i.code==='EVENT_UNAVAILABLE'));
});
