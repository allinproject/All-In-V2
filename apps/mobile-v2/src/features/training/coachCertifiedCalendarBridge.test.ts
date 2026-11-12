import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCoachCertifiedCalendar} from './coachCertifiedCalendarBridge.ts';
import type {PlannedCalendarItem,CompletedCalendarItem} from './trainingCalendarReadModel.ts';
import type {OwnerCalendarWindowSnapshot} from './calendarOwnerReadCertification.ts';

const planned:PlannedCalendarItem={id:'run-1',ownerId:'athlete-a',athleteLocalDate:'2026-11-12',
  sport:'running',state:'planned',planRevisionId:'rev-4'};
const completed:CompletedCalendarItem={id:'actual-1',ownerId:'athlete-a',athleteLocalDate:'2026-11-12',
  sport:'running',source:'recorded',plannedSessionId:'run-1'};
function snapshot<T>(records:readonly T[]):OwnerCalendarWindowSnapshot<T>{
 return{ownerId:'athlete-a',authSessionGeneration:7,fromDate:'2026-11-09',
  throughDate:'2026-11-15',snapshotVersion:'owner-revision-12',complete:true,nextCursor:null,records};
}
function input(p:readonly PlannedCalendarItem[]=[planned],c:readonly CompletedCalendarItem[]=[completed]){
 return{expectedOwnerId:'athlete-a',authenticatedOwnerId:'athlete-a',activeSessionGeneration:7,
  accessGateReady:true,selectedDay:'2026-11-12',view:'week' as const,
  plannedSnapshot:snapshot(p),completedSnapshot:snapshot(c)};
}
test('linked completion replaces same-day planned card without inventing a second session',()=>{
 const result=prepareCoachCertifiedCalendar(input());
 assert.equal(result.kind,'ready');
 if(result.kind!=='ready')return;
 assert.deepEqual(result.calendar.sessions.map(s=>[s.id,s.status]),[['completed:actual-1','completed']]);
 assert.equal(result.noAutomaticPlanWrite,true);
 assert.equal(result.noInferredCompletion,true);
});
test('unlinked actual and planned session remain independently visible',()=>{
 const result=prepareCoachCertifiedCalendar(input([planned],[{...completed,plannedSessionId:null}]));
 assert.equal(result.kind,'ready');
 if(result.kind!=='ready')return;
 assert.deepEqual(result.calendar.sessions.map(s=>s.status),['planned','completed']);
});
test('cross-day completion preserves scheduled date until canonical Training owner reschedules',()=>{
 const result=prepareCoachCertifiedCalendar(input([planned],[{...completed,athleteLocalDate:'2026-11-13'}]));
 assert.equal(result.kind,'ready');
 if(result.kind!=='ready')return;
 assert.deepEqual(result.calendar.sessions.map(s=>s.status),['planned','completed']);
});
test('both owner reads must be complete, authenticated, same generation and same window',()=>{
 const stale=input();stale.completedSnapshot.authSessionGeneration=6;
 assert.equal(prepareCoachCertifiedCalendar(stale).kind,'blocked');
 const partial=input();partial.plannedSnapshot.complete=false;
 assert.equal(prepareCoachCertifiedCalendar(partial).kind,'blocked');
 const cursor=input();cursor.completedSnapshot.nextCursor='next';
 assert.equal(prepareCoachCertifiedCalendar(cursor).kind,'blocked');
 const wrong=input();wrong.plannedSnapshot.ownerId='other';
 assert.equal(prepareCoachCertifiedCalendar(wrong).kind,'blocked');
 const mismatch=input();mismatch.completedSnapshot.throughDate='2026-11-16';
 assert.deepEqual(prepareCoachCertifiedCalendar(mismatch),{kind:'blocked',reason:'snapshot_mismatch'});
});
test('verified empty snapshots are not confused with missing or invalid calendar reads',()=>{
 const empty=prepareCoachCertifiedCalendar(input([],[]));
 assert.equal(empty.kind,'ready');
 if(empty.kind==='ready')assert.deepEqual(empty.calendar.sessions,[]);
 const missing=input();missing.plannedSnapshot=null as unknown as typeof missing.plannedSnapshot;
 assert.equal(prepareCoachCertifiedCalendar(missing).kind,'blocked');
 const duplicate=prepareCoachCertifiedCalendar(input([planned,{...planned}],[]));
 assert.deepEqual(duplicate,{kind:'blocked',reason:'calendar_unavailable'});
});

test('Coach never turns explicit rest/recovery days into workouts',()=>{
 const rest:PlannedCalendarItem={...planned,id:'rest-1',sport:'rest',state:'rest'};
 const recovery:PlannedCalendarItem={...planned,id:'recovery-1',sport:'recovery',state:'recovery'};
 const result=prepareCoachCertifiedCalendar(input([rest,recovery],[]));
 assert.equal(result.kind,'ready');
 if(result.kind==='ready')assert.deepEqual(result.calendar.sessions,[]);
});
test('conflicting canonical completion links are blocked rather than shown as a clean calendar',()=>{
 const mismatch=prepareCoachCertifiedCalendar(input([planned],[{...completed,sport:'cycling'}]));
 assert.deepEqual(mismatch,{kind:'blocked',reason:'calendar_unavailable'});
 const duplicate=prepareCoachCertifiedCalendar(input([planned],[completed,{...completed,id:'actual-2'}]));
 assert.deepEqual(duplicate,{kind:'blocked',reason:'calendar_unavailable'});
});
test('Coach rejects out-of-range and unverified owner data',()=>{
 const outside=input();outside.plannedSnapshot.records=[{...planned,athleteLocalDate:'2026-11-20'}];
 assert.equal(prepareCoachCertifiedCalendar(outside).kind,'blocked');
 const unverified=input();unverified.completedSnapshot.snapshotVersion='';
 assert.equal(prepareCoachCertifiedCalendar(unverified).kind,'blocked');
 const signedOut=input();signedOut.authenticatedOwnerId=null as unknown as string;
 assert.equal(prepareCoachCertifiedCalendar(signedOut).kind,'blocked');
});
