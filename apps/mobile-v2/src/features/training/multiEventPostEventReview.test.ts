import test from 'node:test';
import assert from 'node:assert/strict';
import {proposePostEventSeasonReview} from './multiEventPostEventReview.ts';
const owner='athlete-a',revision='accepted-7',generation=4;
const startDate='2027-03-25',raceA='2027-04-10',raceB='2027-06-05';
const events=[
 {id:'half',name:'Half',date:raceA,sport:'running',priority:'B' as const,demand:'endurance' as const},
 {id:'marathon',name:'Marathon',date:raceB,sport:'running',priority:'A' as const,demand:'endurance' as const}
];
function dates(a:string,b:string){
 const ds:string[]=[];for(let n=Date.parse(a+'T12:00:00Z');n<=Date.parse(b+'T12:00:00Z');n+=86400000)
 ds.push(new Date(n).toISOString().slice(0,10));
 return ds;
}
function base(){
 const common={ownerId:owner,authSessionGeneration:generation,fromDate:startDate,
  throughDate:raceB,snapshotVersion:'snapshot-1',complete:true,nextCursor:null as string|null};
 return {
  expectedOwnerId:owner,authenticatedOwnerId:owner,activeSessionGeneration:generation,
  accessGateReady:true,activePlanRevisionId:revision,startDate,events,
  plannedSnapshot:{...common,records:events.map((e,i)=>({
   id:'session-'+i,ownerId:owner,athleteLocalDate:e.date,sport:'running' as const,
   state:'planned' as const,planRevisionId:revision
  }))},
  daySnapshot:{...common,records:dates(startDate,raceB).map((date,i)=>({
   id:'day-'+i,ownerId:owner,planRevisionId:revision,athleteLocalDate:date,
   dayState:date===raceA||date===raceB?'race' as const:'rest' as const
  }))},
  competitionSnapshot:{...common,records:events.map((e,i)=>({
   eventId:e.id,sessionId:'session-'+i,planRevisionId:revision,ownerId:owner,
   athleteLocalDate:e.date,sport:e.sport,priority:e.priority,competitionConfirmed:true as const
  }))}
 };
}
const resultRow={id:'result-one',ownerId:owner,athleteLocalDate:raceA,
 sport:'running' as const,source:'race_result' as const,plannedSessionId:'session-0'};
function input(){
 return {ownerSeason:base(),currentAcceptedPlanRevisionId:revision,
  completedEventId:'half',athleteLocalToday:'2027-04-11',
  completedSnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:raceA,
   throughDate:raceA,snapshotVersion:'result-snapshot',complete:true,
   nextCursor:null as string|null,records:[resultRow]}}
}
test('verified B event result previews reassessment of the later A race without changing either event',()=>{
 const p=proposePostEventSeasonReview(input());
 assert.equal(p.status,'review_required');
 if(p.status!=='review_required')throw Error(p.reason);
 assert.deepEqual(p.remainingEventIds,['marathon']);
 assert.equal(p.resultId,'result-one');
 assert.equal(p.planRevisionId,revision);
 assert.ok(p.recommendations.some(x=>x.includes('never apply')));
});
test('missing race result does not invent event completion or recovery clearance',()=>{
 const f=input();f.completedSnapshot.records=[];
 assert.equal(proposePostEventSeasonReview(f).status,'awaiting_result');
});
test('device workout is not proof of a certified race result',()=>{
 const f=input();
 f.completedSnapshot.records=[{...resultRow,source:'device_import' as never}];
 assert.equal(proposePostEventSeasonReview(f).status,'awaiting_result');
});
test('stale accepted plan, wrong owner or session generation block post-event reflow',()=>{
 const old=input();old.currentAcceptedPlanRevisionId='revision-old';
 assert.equal(proposePostEventSeasonReview(old).status,'unavailable');
 const foreign=input();foreign.completedSnapshot.ownerId='somebody-else';
 assert.equal(proposePostEventSeasonReview(foreign).status,'unavailable');
 const swapped=input();swapped.ownerSeason.activeSessionGeneration=5;
 assert.equal(proposePostEventSeasonReview(swapped).status,'unavailable');
});
test('wrong race-date or changed session binding cannot authorize a result',()=>{
 const other=input();other.completedSnapshot.records=[{...resultRow,plannedSessionId:'session-1'}];
 assert.equal(proposePostEventSeasonReview(other).status,'awaiting_result');
 const shifted=input();shifted.completedSnapshot.records=[{...resultRow,athleteLocalDate:'2027-04-11'}];
 assert.equal(proposePostEventSeasonReview(shifted).status,'unavailable');
});
test('future races cannot be reflowed as though completed',()=>{
 const f=input();f.completedEventId='marathon';
 assert.equal(proposePostEventSeasonReview(f).status,'unavailable');
});
test('duplicate linked race results are ambiguous and must not silently choose one',()=>{
 const f=input();f.completedSnapshot.records=[resultRow,{...resultRow,id:'result-two'}];
 assert.equal(proposePostEventSeasonReview(f).status,'unavailable');
});
