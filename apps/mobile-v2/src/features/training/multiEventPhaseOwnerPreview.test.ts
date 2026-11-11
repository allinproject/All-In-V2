import test from 'node:test';
import assert from 'node:assert/strict';
import {previewCertifiedSeasonPhases,seasonPhasePreviewIdentity} from './multiEventPhaseOwnerPreview.ts';
import type {SeasonEvent} from './multiEventSeasonPlan.ts';
import type {EventPhaseDecision} from './multiEventPhaseReview.ts';

const owner='athlete-a',revision='accepted-7',generation=4;
const start='2027-03-25',first='2027-04-10',last='2027-06-05';
const events:SeasonEvent[]=[
 {id:'half',name:'Half marathon',date:first,sport:'running',priority:'B',demand:'endurance'},
 {id:'marathon',name:'Marathon',date:last,sport:'running',priority:'A',demand:'endurance'}
];
const dayDates:string[]=[];
for(let n=Date.parse(start+'T12:00:00Z');n<=Date.parse(last+'T12:00:00Z');n+=86400000)
 dayDates.push(new Date(n).toISOString().slice(0,10));
function args(){
 const common={ownerId:owner,authSessionGeneration:generation,fromDate:start,throughDate:last,
  snapshotVersion:'snapshot-1',complete:true,nextCursor:null as string|null};
 const ownerSeason={
  expectedOwnerId:owner,authenticatedOwnerId:owner,activeSessionGeneration:generation,
  accessGateReady:true,activePlanRevisionId:revision,startDate:start,events,
  plannedSnapshot:{...common,records:events.map((e,i)=>({
   id:'session-'+i,ownerId:owner,athleteLocalDate:e.date,sport:'running' as const,
   state:'planned' as const,planRevisionId:revision
  }))},
  daySnapshot:{...common,records:dayDates.map((date,i)=>({
   id:'day-'+i,ownerId:owner,planRevisionId:revision,athleteLocalDate:date,
   dayState:date===first||date===last?'race' as const:'rest' as const
  }))},
  competitionSnapshot:{...common,records:events.map((e,i)=>({
   eventId:e.id,sessionId:'session-'+i,planRevisionId:revision,ownerId:owner,
   athleteLocalDate:e.date,sport:e.sport,competitionConfirmed:true as const
  }))}
 };
 const phaseDecisions:EventPhaseDecision[]=[
  {eventId:'half',effort:'supported',taperDays:3,recoveryReviewDays:3,
   source:'athlete_confirmed',evidenceRefs:[]},
  {eventId:'marathon',effort:'peak',taperDays:12,recoveryReviewDays:null,
   source:'coach_evidence_reviewed',evidenceRefs:['reviewed-race-and-history']}
 ];
 return {ownerSeason,expectedPlanRevisionId:revision,phaseDecisions};
}
test('certified A/B season preview contains review windows and exact accepted revision',()=>{
 const p=previewCertifiedSeasonPhases(args());
 assert.equal(p.status,'review_required');
 if(p.status==='unavailable')throw Error(p.reason);
 assert.equal(p.planRevisionId,revision);
 assert.equal(p.phases.annotations.filter(a=>a.kind==='event').length,2);
 assert.deepEqual(seasonPhasePreviewIdentity(p),{
  ownerId:owner,planRevisionId:revision,snapshotVersion:'snapshot-1',
  requiresAthleteApproval:true,canWriteAcceptedPlan:false
 });
});
test('stale revision or switched account never produces a phase preview',()=>{
 const stale=args();stale.expectedPlanRevisionId='old';
 assert.equal(previewCertifiedSeasonPhases(stale).status,'unavailable');
 const switched=args();switched.ownerSeason.authenticatedOwnerId='foreign';
 assert.equal(previewCertifiedSeasonPhases(switched).status,'unavailable');
 const generationChanged=args();generationChanged.ownerSeason.activeSessionGeneration=99;
 assert.equal(previewCertifiedSeasonPhases(generationChanged).status,'unavailable');
});
test('uncertified competition, missing plan days and incomplete owner reads fail closed',()=>{
 const competition=args();competition.ownerSeason.competitionSnapshot.records[0]={
  ...competition.ownerSeason.competitionSnapshot.records[0],competitionConfirmed:false as never
 };
 assert.equal(previewCertifiedSeasonPhases(competition).status,'unavailable');
 const missing=args();missing.ownerSeason.daySnapshot.records.pop();
 assert.equal(previewCertifiedSeasonPhases(missing).status,'unavailable');
 const cursored=args();cursored.ownerSeason.plannedSnapshot.nextCursor='cursor';
 assert.equal(previewCertifiedSeasonPhases(cursored).status,'unavailable');
});
test('phase evidence missing or invalid is unavailable rather than manufactured',()=>{
 const missing=args();missing.phaseDecisions=missing.phaseDecisions.slice(0,1);
 assert.equal(previewCertifiedSeasonPhases(missing).status,'unavailable');
 const unsourced=args();unsourced.phaseDecisions[1].evidenceRefs=[];
 assert.equal(previewCertifiedSeasonPhases(unsourced).status,'unavailable');
});
