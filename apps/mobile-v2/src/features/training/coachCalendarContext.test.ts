import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCoachCalendarContext } from './coachCalendarContext.ts';

const session = {
 id:'rev-sess-run-12',ownerId:'athlete-a',athleteLocalDate:'2026-11-12',
 sport:'running' as const,status:'planned' as const,planRevisionId:'accepted-rev-3',
};
const base = {expectedOwnerId:'athlete-a',authenticatedOwnerId:'athlete-a',accessGateReady:true,
 selectedDay:'2026-11-10',view:'week' as const,sessions:[session]};
test('Coach sees selected Tuesday and adjacent Thursday run only with verified canonical evidence',()=>{
 const result=prepareCoachCalendarContext(base);
 assert.equal(result.kind,'ready');
 if(result.kind==='ready'){
  assert.equal(result.scope,'train_calendar_read_only');
  assert.equal(result.selectedDay,'2026-11-10');
  assert.deepEqual(result.selectedWeek,['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15']);
  assert.deepEqual(result.sessions,[session]);
  assert.equal(result.noAutomaticPlanWrite,true);
 }
});
test('Coach context refuses missing/unverified schedule rather than inventing sessions',()=>{
 for(const sessions of [undefined,null]){
  assert.deepEqual(prepareCoachCalendarContext({...base,sessions}),{kind:'blocked',reason:'sessions_unverified'});
 }
 assert.equal(prepareCoachCalendarContext({...base,sessions:[]}).kind,'ready');
});
test('account switching, access gate, and cross-account workout are blocked',()=>{
 assert.deepEqual(prepareCoachCalendarContext({...base,authenticatedOwnerId:null}),{kind:'blocked',reason:'signed_out'});
 assert.deepEqual(prepareCoachCalendarContext({...base,authenticatedOwnerId:'athlete-b'}),{kind:'blocked',reason:'wrong_owner'});
 assert.deepEqual(prepareCoachCalendarContext({...base,accessGateReady:false}),{kind:'blocked',reason:'access_gate_required'});
 assert.deepEqual(prepareCoachCalendarContext({...base,sessions:[{...session,ownerId:'athlete-b'}]}),{kind:'blocked',reason:'session_owner_mismatch'});
});
test('stale/ambiguous session identities and invalid day cannot enter Coach context',()=>{
 assert.deepEqual(prepareCoachCalendarContext({...base,selectedDay:'2026-02-30'}),{kind:'blocked',reason:'invalid_day'});
 assert.deepEqual(prepareCoachCalendarContext({...base,sessions:[session,session]}),{kind:'blocked',reason:'invalid_session'});
 assert.deepEqual(prepareCoachCalendarContext({...base,sessions:[{...session,planRevisionId:''}]}),{kind:'blocked',reason:'invalid_session'});
});
test('month view uses the whole selected month; week view remains a week only',()=>{
 const older={...session,id:'old-run',athleteLocalDate:'2026-11-02'};
 const previousMonth={...session,id:'oct-run',athleteLocalDate:'2026-10-30'};
 const month=prepareCoachCalendarContext({...base,view:'month',sessions:[session,older,previousMonth]});
 assert.equal(month.kind,'ready');
 if(month.kind==='ready'){
  assert.deepEqual(month.sessions,[session,older]);
  assert.equal(month.windowDays.length,30);
  assert.equal(month.selectedMonth,'2026-11-01');
 }
 const week=prepareCoachCalendarContext({...base,view:'week',sessions:[session,older,previousMonth]});
 assert.equal(week.kind,'ready');
 if(week.kind==='ready')assert.deepEqual(week.sessions,[session]);
});
