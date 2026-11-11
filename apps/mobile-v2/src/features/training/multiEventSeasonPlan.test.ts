import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMultiEventSeasonPlan,assertMultiEventSeasonAssigned,type SeasonEvent} from './multiEventSeasonPlan.ts';
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
