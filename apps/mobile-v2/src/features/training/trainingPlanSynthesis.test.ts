import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeTrainingWeek,adaptTrainingDay,type TrainingAthletePlanContext,type TrainingSessionIntent} from './trainingPlanSynthesis.ts';
const context=(requiredSports:TrainingAthletePlanContext['requiredSports']):TrainingAthletePlanContext=>({primaryGoal:{id:'goal-1',label:'Half marathon performance',sports:['running']},secondaryGoals:[{id:'goal-2',label:'Strength maintenance',sports:['strength']}],availableDays:['monday','tuesday','wednesday','thursday','friday','saturday'],activeRestrictions:['lying_leg_curl'],requiredSports,maxSessionsPerDay:2});
const session=(id:string,sport:TrainingSessionIntent['sport'],priority:TrainingSessionIntent['priority'],intensity:TrainingSessionIntent['intensity'],tag:string):TrainingSessionIntent=>({id,sport,label:id,purpose:'Evidence-backed intent',priority,intensity,durationMinutes:45,demand:{aerobic:sport==='running'?'high':'moderate',mechanicalImpact:sport==='running'?'high':'low',localMuscular:sport==='strength'?'high':'moderate',technicalSkill:'not_applicable'},stressTags:[tag],evidenceRefs:['fixture:evidence']});
test('runner plus strength produces a reviewable proposal',()=>{const p=synthesizeTrainingWeek(context(['running','strength']),[session('long-run','running','competition','moderate','run_impact'),session('quality-run','running','key','hard','run_impact'),session('strength-a','strength','supporting','moderate','lower_body'),session('strength-b','strength','supporting','moderate','upper_body')]);assert.equal(p.status,'review_required');assert.equal(p.days.flatMap(d=>d.sessions).length,4);assert.equal(p.invariants.sportsKeptSeparate,true)});
test('runner, cyclist and strength athlete retains all three distinct modalities',()=>{const c=context(['running','cycling','strength']);c.secondaryGoals.push({id:'goal-3',label:'Cycling',sports:['cycling']});const p=synthesizeTrainingWeek(c,[session('long-run','running','competition','moderate','run_impact'),session('bike','cycling','key','moderate','bike_aerobic'),session('strength','strength','supporting','moderate','lower_body')]);assert.equal(p.status,'review_required');assert.deepEqual(new Set(p.days.flatMap(d=>d.sessions.map(s=>s.sport))),new Set(['running','cycling','strength']))});
test('active exercise restriction blocks conflicting proposal',()=>{const p=synthesizeTrainingWeek(context(['running','strength']),[session('bad','strength','key','hard','lying_leg_curl')]);assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='EXERCISE_RESTRICTED'))});
test('fixed commitment is not silently rescheduled',()=>{const s={...session('race','running','competition','hard','run_impact'),fixedDay:'sunday' as const};const p=synthesizeTrainingWeek(context(['running']),[s]);assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='FIXED_DAY_UNAVAILABLE'))});
test('same-day and adjacent high-demand sessions are surfaced',()=>{const p=synthesizeTrainingWeek(context(['running','strength','cycling']),[{...session('run','running','key','hard','run_impact'),fixedDay:'monday'},{...session('lift','strength','key','hard','lower_body'),fixedDay:'monday'},{...session('bike','cycling','key','hard','bike_aerobic'),fixedDay:'tuesday'}]);assert.ok(p.issues.some(i=>i.code==='MULTIPLE_HARD_SESSIONS_SAME_DAY'));assert.ok(p.issues.some(i=>i.code==='ADJACENT_HIGH_DEMAND_DAYS'))});
test('normal/unknown day signals keep plan unchanged',()=>{const r=adaptTrainingDay({planned:session('long','running','competition','moderate','run_impact'),report:{fatigue:'unknown',soreness:'unknown',sleep:'unknown',performance:'unknown',painOrIllnessConcern:false}});assert.equal(r.action,'keep');assert.equal(r.preservesOriginalPlan,true)});
test('pain/illness concerns require review, never an invented replacement',()=>{const r=adaptTrainingDay({planned:session('long','running','competition','moderate','run_impact'),report:{fatigue:'high',soreness:'severe',sleep:'poor',performance:'below_expected',painOrIllnessConcern:true}});assert.equal(r.action,'review');assert.equal(r.confidence,'high');assert.equal(r.requiresAthleteApproval,true)});
test('isolated fatigue signal can reduce supporting work without rewriting accepted plan',()=>{const r=adaptTrainingDay({planned:session('easy','cycling','supporting','easy','bike'),report:{fatigue:'elevated',soreness:'mild',sleep:'usual',performance:'normal',painOrIllnessConcern:false}});assert.equal(r.action,'reduce');assert.equal(r.preservesOriginalPlan,true)});

test('preserves an athlete-approved four-superset strength structure',()=>{const c=context(['strength']);c.strengthStructureRules=[{id:'legs-abs-rule',day:'monday',format:'supersets',blockCount:4,roundsPerBlock:3,requiredRoles:['major','abdominal'],movementsPerBlock:2}];const block=(id:string)=>({id,rounds:3,movements:[{exerciseId:'bulgarian_split_squat',role:'major' as const,sets:3,reps:'8-10'},{exerciseId:'cable_crunch',role:'abdominal' as const,sets:3,reps:'12-15'}]});const s={...session('monday-legs-abs','strength','key','moderate','lower_body'),fixedDay:'monday' as const,strengthWorkout:{format:'supersets' as const,blocks:[block('1'),block('2'),block('3'),block('4')]}};const p=synthesizeTrainingWeek(c,[s]);assert.notEqual(p.status,'blocked');assert.equal(p.days.find(d=>d.day==='monday')?.sessions[0].strengthWorkout?.blocks.length,4)});
test('rejects the outdated generic strength format when it violates the saved structure',()=>{const c=context(['running','strength']);c.strengthStructureRules=[{id:'legs-abs-rule',day:'monday',format:'supersets',blockCount:4,roundsPerBlock:3,requiredRoles:['major','abdominal'],movementsPerBlock:2}];const s={...session('monday-legs-abs','strength','key','moderate','lower_body'),fixedDay:'monday' as const,strengthWorkout:{format:'supersets' as const,blocks:[{id:'1',rounds:3,movements:[{exerciseId:'squat',role:'major' as const,sets:3,reps:'8'},{exerciseId:'crunch',role:'abdominal' as const,sets:3,reps:'12'}]},{id:'2',rounds:3,movements:[{exerciseId:'deadlift',role:'major' as const,sets:3,reps:'8'},{exerciseId:'pallof',role:'abdominal' as const,sets:3,reps:'12'}]}]}};const p=synthesizeTrainingWeek(c,[s]);assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='STRENGTH_STRUCTURE_INVALID'))});
test('hard exercise restrictions are checked against structured movement IDs',()=>{const c=context(['running','strength']);const s={...session('leg-day','strength','key','moderate','lower_body'),strengthWorkout:{format:'straight_sets' as const,blocks:[{id:'1',rounds:3,movements:[{exerciseId:'lying_leg_curl',role:'accessory' as const,sets:3,reps:'10-15'}]}]}};const p=synthesizeTrainingWeek(c,[s]);assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='EXERCISE_RESTRICTED'))});

test('malformed Coach session intents are rejected instead of crashing the scheduler',()=>{const p=synthesizeTrainingWeek(context(['running']),[null as any,{id:'bad',priority:'key'} as any]);assert.equal(p.status,'blocked');assert.ok(p.issues.some(i=>i.code==='UNSUPPORTED_PRESCRIPTION'))});

test('Coach rejects disallowed exercise when restriction uses human-readable spaces',()=>{
 const c=context(['running','strength']);
 c.activeRestrictions=['Lying Leg Curl'];
 const s={...session('leg-day','strength','key','moderate','lower_body'),strengthWorkout:{format:'straight_sets' as const,blocks:[{id:'1',rounds:3,movements:[{exerciseId:'lying_leg_curl',role:'accessory' as const,sets:3,reps:'10'}]}]}};
 const p=synthesizeTrainingWeek(c,[s]);
 assert.equal(p.status,'blocked');
 assert.ok(p.issues.some(i=>i.code==='EXERCISE_RESTRICTED'));
 assert.equal(p.days.flatMap(d=>d.sessions).length,0);
});
test('Coach also matches spaced stress tags against underscored restrictions',()=>{
 const c=context(['running']);
 const p=synthesizeTrainingWeek(c,[session('restricted-run','running','key','hard','low back impact')]);
 c.activeRestrictions=['low_back_impact'];
 const blocked=synthesizeTrainingWeek(c,[session('restricted-run','running','key','hard','low back impact')]);
 assert.equal(p.issues.some(i=>i.code==='EXERCISE_RESTRICTED'),false);
 assert.ok(blocked.issues.some(i=>i.code==='EXERCISE_RESTRICTED'));
});

test('malformed preferred days fail closed instead of throwing during scheduling',()=>{
 const invalid={...session('run','running','key','moderate','run_impact'),preferredDays:'monday' as any};
 const result=synthesizeTrainingWeek(context(['running']),[invalid]);
 assert.equal(result.status,'blocked');
 assert.ok(result.issues.some(issue=>issue.code==='UNSUPPORTED_PRESCRIPTION'));
});

test('unknown fixed days fail closed without a planner exception',()=>{
 const invalid={...session('run','running','key','moderate','run_impact'),fixedDay:'funday' as any};
 const result=synthesizeTrainingWeek(context(['running']),[invalid]);
 assert.equal(result.status,'blocked');
 assert.ok(result.issues.some(issue=>issue.code==='UNSUPPORTED_PRESCRIPTION'));
});

test('malformed daily session capacity is rejected rather than silently mis-scheduling Coach intents',()=>{
 for(const maxSessionsPerDay of [Number.NaN,0,-1,1.5,Number.POSITIVE_INFINITY]){
  const c=context(['running']);c.maxSessionsPerDay=maxSessionsPerDay;
  assert.throws(()=>synthesizeTrainingWeek(c,[session('run','running','key','moderate','run_impact')]),/Daily session capacity/);
 }
 const c=context(['running']);c.maxSessionsPerDay=1;
 const result=synthesizeTrainingWeek(c,[session('run','running','key','moderate','run_impact')]);
 assert.equal(result.status,'review_required');
});
