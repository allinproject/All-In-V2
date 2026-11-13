import test from 'node:test';
import assert from 'node:assert/strict';
import {readAuthenticatedCalendarWindow, type CalendarWindowRequest, type CalendarWindowServices} from './calendarAuthenticatedWindow.ts';
import type {OwnerCalendarWindowSnapshot} from './calendarOwnerReadCertification.ts';
import type {PlannedCalendarItem,CompletedCalendarItem} from './trainingCalendarReadModel.ts';

const request:CalendarWindowRequest={expectedOwnerId:'owner-a',authSessionGeneration:3,fromDate:'2026-11-12',throughDate:'2026-11-12'};
const plan:PlannedCalendarItem={id:'plan-a',ownerId:'owner-a',athleteLocalDate:'2026-11-12',sport:'running',state:'planned',planRevisionId:'revision-a'};
const completed:CompletedCalendarItem={id:'actual-a',ownerId:'owner-a',athleteLocalDate:'2026-11-12',sport:'cycling',source:'recorded',plannedSessionId:null};
const snapshot=<T>(records:readonly T[]):OwnerCalendarWindowSnapshot<T>=>({
 ownerId:'owner-a',authSessionGeneration:3,fromDate:'2026-11-12',throughDate:'2026-11-12',
 snapshotVersion:'rev-3',complete:true,nextCursor:null,records,
});
const services=():CalendarWindowServices=>({
 authenticateOwner:async()=>{},
 readPlanned:async()=>snapshot([plan]),
 readCompleted:async()=>snapshot([completed]),
});
test('both independently certified owner sources yield verified planned and actual records',async()=>{
 const result=await readAuthenticatedCalendarWindow(services(),request);
 assert.equal(result.status,'ready');
 assert.equal(result.planned.status,'ready');
 assert.equal(result.completed.status,'ready');
 assert.equal(result.markers.status,'ready');
});
test('failed completed source remains partial without fabricating empty completed history',async()=>{
 const result=await readAuthenticatedCalendarWindow({...services(),readCompleted:async()=>{throw Error('offline');}},request);
 assert.equal(result.status,'partial');
 assert.equal(result.completed.status,'unavailable');
 assert.equal(result.markers.status,'unavailable');
});
test('missing pages, stale generation and foreign owner never certify activity',async()=>{
 const variants=[
  {...snapshot([completed]),complete:false},
  {...snapshot([completed]),nextCursor:'next'},
  {...snapshot([completed]),authSessionGeneration:2},
  {...snapshot([completed]),ownerId:'owner-b'},
 ];
 for(const data of variants){
  const result=await readAuthenticatedCalendarWindow({...services(),readCompleted:async()=>data},request);
  assert.equal(result.completed.status,'unavailable');
  assert.equal(result.status,'partial');
 }
});
test('authentication change after network reads fails completely closed',async()=>{
 let calls=0;
 const result=await readAuthenticatedCalendarWindow({...services(),
  authenticateOwner:async()=>{if(++calls===2)throw Error('session changed');},
 },request);
 assert.equal(result.status,'unavailable');
});
test('view cancelled during owner reads cannot use previously fetched evidence',async()=>{
 let current=true;
 const result=await readAuthenticatedCalendarWindow({...services(),
  readPlanned:async()=>{current=false;return snapshot([plan]);},
 },request,()=>current);
 assert.equal(result.status,'unavailable');
});
