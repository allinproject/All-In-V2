import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMultiEventSeasonPlan} from './multiEventSeasonPlan.ts';
import {reviewMultiEventPhaseWindows,type EventPhaseDecision} from './multiEventPhaseReview.ts';
const events=[
 {id:'half',date:'2027-04-10',priority:'B' as const,name:'Half',sport:'running',demand:'endurance' as const},
 {id:'marathon',date:'2027-06-05',priority:'A' as const,name:'Marathon',sport:'running',demand:'endurance' as const}
];
const season=()=>buildMultiEventSeasonPlan({startDate:'2027-03-01',events});
const decisions=():EventPhaseDecision[]=>[
 {eventId:'half',effort:'supported',taperDays:3,recoveryReviewDays:5,source:'athlete_confirmed',evidenceRefs:[]},
 {eventId:'marathon',effort:'peak',taperDays:12,recoveryReviewDays:14,source:'coach_evidence_reviewed',evidenceRefs:['verified-athlete-history']}
];
test('A/B season receives explicit separate taper/recovery reviews without modifying accepted days',()=>{
 const s=season(),old=s.days.map(d=>d.state),result=reviewMultiEventPhaseWindows({season:s,decisions:decisions()});
 assert.equal(result.status,'review_required');
 assert.deepEqual(s.days.map(d=>d.state),old);
 assert.equal(result.annotations.filter(a=>a.kind==='event').length,2);
 assert.equal(result.annotations.filter(a=>a.kind==='taper_review'&&a.eventId==='half').length,3);
 assert.equal(result.annotations.filter(a=>a.kind==='taper_review'&&a.eventId==='marathon').length,12);
 assert.equal(result.annotations.filter(a=>a.kind==='post_event_recovery_review'&&a.eventId==='half').length,5);
 assert.deepEqual(result.uncoveredPostSeason,[{eventId:'marathon',throughDate:'2027-06-19'}]);
 assert.equal(result.invariants.noAutomaticPlanWrite,true);
});
test('missing athlete evidence does not fabricate taper or return-to-training dates',()=>{
 const d=decisions();d[1]={...d[1],taperDays:null,recoveryReviewDays:null};
 const r=reviewMultiEventPhaseWindows({season:season(),decisions:d});
 assert.ok(r.issues.filter(i=>i.code==='MISSING_PHASE_EVIDENCE').length===2);
 assert.equal(r.annotations.filter(a=>a.eventId==='marathon'&&a.kind==='taper_review').length,0);
});
test('two events close together reveal recovery/taper and race/recovery overlap',()=>{
 const s=buildMultiEventSeasonPlan({startDate:'2027-03-01',events:[
  {...events[0],date:'2027-04-10'},
  {...events[1],date:'2027-04-21'}
 ]});
 const d=decisions();d[0].recoveryReviewDays=15;d[1].taperDays=6;
 const r=reviewMultiEventPhaseWindows({season:s,decisions:d});
 assert.ok(r.issues.some(i=>i.code==='OVERLAPPING_TAPER_RECOVERY'));
 assert.ok(r.issues.some(i=>i.code==='EVENT_IN_RECOVERY_WINDOW'));
 assert.deepEqual(s.events.map(e=>e.date),['2027-04-10','2027-04-21']);
});
test('C practice event receives no unsupported automatic taper',()=>{
 const e=[{...events[0],priority:'C' as const},events[1]];
 const s=buildMultiEventSeasonPlan({startDate:'2027-03-01',events:e});
 const d=decisions();d[0].effort='practice';d[0].taperDays=10;
 const r=reviewMultiEventPhaseWindows({season:s,decisions:d});
 assert.equal(r.annotations.filter(a=>a.kind==='taper_review'&&a.eventId==='half').length,0);
 assert.ok(!r.issues.some(i=>i.code==='UNSUPPORTED_PEAK'));
});
test('C event requested as peak requires explicit priority review',()=>{
 const s=buildMultiEventSeasonPlan({startDate:'2027-03-01',events:[{...events[0],priority:'C' as const},events[1]]});
 const d=decisions();d[0].effort='peak';
 assert.ok(reviewMultiEventPhaseWindows({season:s,decisions:d}).issues.some(i=>i.code==='UNSUPPORTED_PEAK'));
});
test('missing, duplicate, unsourced or invalid phase decisions are refused',()=>{
 const s=season();
 assert.throws(()=>reviewMultiEventPhaseWindows({season:s,decisions:decisions().slice(0,1)}));
 assert.throws(()=>reviewMultiEventPhaseWindows({season:s,decisions:[decisions()[0],decisions()[0]]}));
 const noSource=decisions();noSource[1]={...noSource[1],evidenceRefs:[]};
 assert.throws(()=>reviewMultiEventPhaseWindows({season:s,decisions:noSource}));
 const negative=decisions();negative[0].recoveryReviewDays=-1;
 assert.throws(()=>reviewMultiEventPhaseWindows({season:s,decisions:negative}));
});
test('unavailable canonical day is retained and flagged, never overwritten by taper',()=>{
 const base=season();
 const states=Object.fromEntries(base.days.map(d=>[d.date,d.date==='2027-06-01'?'unavailable' as const:d.isRaceDay?'race' as const:'rest' as const]));
 const s=buildMultiEventSeasonPlan({startDate:'2027-03-01',events,dayStates:states});
 const r=reviewMultiEventPhaseWindows({season:s,decisions:decisions()});
 assert.ok(r.issues.some(i=>i.code==='PHASE_CONFLICTS_WITH_CANONICAL_DAY'&&i.date==='2027-06-01'));
 assert.equal(s.days.find(d=>d.date==='2027-06-01')?.state,'unavailable');
});

test('tune-up event inside later A-race taper requires explicit coaching tradeoff',()=>{
 const s=buildMultiEventSeasonPlan({startDate:'2027-03-01',events:[
  {...events[0],date:'2027-05-29'},
  {...events[1],date:'2027-06-05'}
 ]});
 const d=decisions();d[0].recoveryReviewDays=0;d[1].taperDays=14;
 const r=reviewMultiEventPhaseWindows({season:s,decisions:d});
 assert.ok(r.issues.some(i=>i.code==='EVENT_IN_OTHER_TAPER_WINDOW'&&i.eventIds.includes('half')&&i.eventIds.includes('marathon')));
});
test('taper extending before confirmed season start is flagged and does not backfill workouts',()=>{
 const s=buildMultiEventSeasonPlan({startDate:'2027-03-30',events});
 const d=decisions();d[0].taperDays=20;
 const r=reviewMultiEventPhaseWindows({season:s,decisions:d});
 assert.ok(r.issues.some(i=>i.code==='TAPER_BEFORE_CALENDAR'&&i.eventIds.includes('half')));
 assert.ok(r.annotations.every(a=>a.date>=s.startDate));
});
