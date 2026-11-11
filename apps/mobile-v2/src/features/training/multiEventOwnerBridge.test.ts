import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeSeasonFromVerifiedTraining,projectVerifiedMultiEventDayMarkers} from './multiEventOwnerBridge.ts';
import type {SeasonEvent} from './multiEventSeasonPlan.ts';
const owner='owner-a',revision='revision-7',generation=12;
const events:SeasonEvent[]=[
 {id:'event-one',date:'2027-04-10',name:'Half marathon',sport:'running',priority:'B',demand:'endurance'},
 {id:'event-two',date:'2027-06-05',name:'Marathon',sport:'running',priority:'A',demand:'endurance'}
];
function dates(start:string,end:string):string[]{
 const result:string[]=[];
 for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d=new Date(d.getTime()+86400000))
  result.push(d.toISOString().slice(0,10));
 return result;
}
const startDate='2027-03-27';
const allDays=dates(startDate,'2027-06-05');
const dayRows=allDays.map((date,i)=>({id:'day-'+i,ownerId:owner,planRevisionId:revision,
 athleteLocalDate:date,dayState:events.some(e=>e.date===date)?'race' as const:'rest' as const}));
const plannedRows=events.map((e,i)=>({id:'session-'+i,ownerId:owner,athleteLocalDate:e.date,
 sport:'running' as const,state:'planned' as const,planRevisionId:revision}));
const bindings=events.map((e,i)=>({eventId:e.id,sessionId:'session-'+i,planRevisionId:revision,
 ownerId:owner,athleteLocalDate:e.date,sport:e.sport,competitionConfirmed:true as const}));
function fixture(){
 return {expectedOwnerId:owner,authenticatedOwnerId:owner,activeSessionGeneration:generation,
 accessGateReady:true,activePlanRevisionId:revision,startDate,events:[...events],
 plannedSnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:startDate,
  throughDate:'2027-06-05',snapshotVersion:'snapshot-9',complete:true,nextCursor:null as string|null,
  records:[...plannedRows]},
 daySnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:startDate,
  throughDate:'2027-06-05',snapshotVersion:'snapshot-9',complete:true,nextCursor:null as string|null,
  records:[...dayRows]},
 competitionSnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:startDate,
  throughDate:'2027-06-05',snapshotVersion:'snapshot-9',complete:true,nextCursor:null as string|null,
  records:[...bindings]}}
}
test('certified current-revision owner calendar builds one season with exact A and B events',()=>{
 const result=proposeSeasonFromVerifiedTraining(fixture());
 assert.equal(result.status,'review_required');
 if(result.status==='unavailable')throw Error(result.reason);
 assert.equal(result.planRevisionId,revision);
 assert.deepEqual(result.proposal.days.filter(x=>x.isRaceDay).map(x=>x.date),events.map(x=>x.date));
 assert.equal(result.proposal.invariants.noAutomaticWrite,true);
});
test('owner switch and stale session generation reject prior account data',()=>{
 assert.equal(proposeSeasonFromVerifiedTraining({...fixture(),authenticatedOwnerId:'owner-b'}).status,'unavailable');
 assert.equal(proposeSeasonFromVerifiedTraining({...fixture(),activeSessionGeneration:13}).status,'unavailable');
 assert.equal(proposeSeasonFromVerifiedTraining({...fixture(),accessGateReady:false}).status,'unavailable');
});
test('incomplete, paginated and mixed-version reads fail closed',()=>{
 const partial=fixture();partial.plannedSnapshot.complete=false;
 assert.equal(proposeSeasonFromVerifiedTraining(partial).status,'unavailable');
 const paged=fixture();paged.daySnapshot.nextCursor='more';
 assert.equal(proposeSeasonFromVerifiedTraining(paged).status,'unavailable');
 const changed=fixture();changed.plannedSnapshot.snapshotVersion='other';
 assert.equal(proposeSeasonFromVerifiedTraining(changed).status,'unavailable');
});
test('missing middle date cannot silently become a rest day',()=>{
 const f=fixture();f.daySnapshot.records=f.daySnapshot.records.filter(d=>d.athleteLocalDate!=='2027-05-01');
 assert.equal(proposeSeasonFromVerifiedTraining(f).status,'unavailable');
});
test('event bindings require unique exact canonical session, date, sport and revision',()=>{
 const wrong=fixture();wrong.competitionSnapshot.records[0]={...wrong.competitionSnapshot.records[0],planRevisionId:'old'};
 assert.equal(proposeSeasonFromVerifiedTraining(wrong).status,'unavailable');
 const moved=fixture();moved.plannedSnapshot.records[0]={...moved.plannedSnapshot.records[0],athleteLocalDate:'2027-04-11'};
 assert.equal(proposeSeasonFromVerifiedTraining(moved).status,'unavailable');
 const dup=fixture();dup.competitionSnapshot.records[1]={...dup.competitionSnapshot.records[1],sessionId:'session-0'};
 assert.equal(proposeSeasonFromVerifiedTraining(dup).status,'unavailable');
});
test('foreign and stale accepted plan rows do not reach Coach proposal',()=>{
 const foreign=fixture();foreign.daySnapshot.records[5]={...foreign.daySnapshot.records[5],ownerId:'owner-b'};
 assert.equal(proposeSeasonFromVerifiedTraining(foreign).status,'unavailable');
 const stale=fixture();stale.plannedSnapshot.records[0]={...stale.plannedSnapshot.records[0],planRevisionId:'old'};
 assert.equal(proposeSeasonFromVerifiedTraining(stale).status,'unavailable');
});
test('event owner date must be certified race and snapshot cannot suppress it',()=>{
 const f=fixture();f.daySnapshot.records=f.daySnapshot.records.map(d=>d.athleteLocalDate==='2027-04-10'?{...d,dayState:'rest' as const}:d);
 assert.equal(proposeSeasonFromVerifiedTraining(f).status,'unavailable');
});

test('competition classification must be certified by the same Training owner snapshot',()=>{
 const unconfirmed=fixture();
 unconfirmed.competitionSnapshot.records[0]={
  ...unconfirmed.competitionSnapshot.records[0],competitionConfirmed:false as never
 };
 assert.equal(proposeSeasonFromVerifiedTraining(unconfirmed).status,'unavailable');
 const stale=fixture();stale.competitionSnapshot.snapshotVersion='old-snapshot';
 assert.equal(proposeSeasonFromVerifiedTraining(stale).status,'unavailable');
 const foreign=fixture();foreign.competitionSnapshot.records[0]={
  ...foreign.competitionSnapshot.records[0],ownerId:'different'
 };
 assert.equal(proposeSeasonFromVerifiedTraining(foreign).status,'unavailable');
 const partial=fixture();partial.competitionSnapshot.nextCursor='page-two';
 assert.equal(proposeSeasonFromVerifiedTraining(partial).status,'unavailable');
});

test('certified two-event season projects both race markers into the existing Training calendar',()=>{
 const result=projectVerifiedMultiEventDayMarkers(fixture());
 assert.equal(result.status,'ready');
 if(result.status!=='ready')throw Error(result.reason);
 assert.deepEqual(result.markers.filter(m=>m.status==='race').map(m=>m.athleteLocalDate),['2027-04-10','2027-06-05']);
 assert.equal(result.planRevisionId,revision);
});
test('race marker projection cannot bypass owner, revision or certified race state',()=>{
 const swapped=fixture();swapped.authenticatedOwnerId='owner-b';
 assert.equal(projectVerifiedMultiEventDayMarkers(swapped).status,'unavailable');
 const date=fixture();date.daySnapshot.records=date.daySnapshot.records.map(d=>d.athleteLocalDate==='2027-04-10'?{...d,dayState:'rest' as const}:d);
 assert.equal(projectVerifiedMultiEventDayMarkers(date).status,'unavailable');
});
