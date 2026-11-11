import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCoachSeasonContext} from './coachCalendarContext.ts';
import {buildMultiEventSeasonPlan} from './multiEventSeasonPlan.ts';
import {reviewMultiEventPhaseWindows} from './multiEventPhaseReview.ts';
import type {SeasonPhasePreview} from './multiEventPhaseOwnerPreview.ts';

const events=[
 {id:'tuneup',name:'Tune-up half marathon',date:'2027-04-10',priority:'B' as const,sport:'running',demand:'endurance' as const},
 {id:'goal',name:'Goal marathon',date:'2027-06-05',priority:'A' as const,sport:'running',demand:'endurance' as const}
];
function preview():SeasonPhasePreview{
 const draft=buildMultiEventSeasonPlan({startDate:'2027-03-01',events});
 const phases=reviewMultiEventPhaseWindows({season:draft,decisions:[
  {eventId:'tuneup',effort:'supported',taperDays:2,recoveryReviewDays:4,source:'athlete_confirmed',evidenceRefs:[]},
  {eventId:'goal',effort:'peak',taperDays:null,recoveryReviewDays:null,source:'athlete_confirmed',evidenceRefs:[]}
 ]});
 return{status:'review_required',reason:null,draft,phases,ownerId:'athlete-1',planRevisionId:'rev-4',
  snapshotVersion:'certified-9',requiresAthleteApproval:true,canWriteAcceptedPlan:false};
}
const input=()=>({expectedOwnerId:'athlete-1',authenticatedOwnerId:'athlete-1',
 activePlanRevisionId:'rev-4',accessGateReady:true,preview:preview()});
test('Coach sees complete A/B season hierarchy and unresolved recovery, not fake training loads',()=>{
 const x=prepareCoachSeasonContext(input());
 assert.equal(x.kind,'ready');
 if(x.kind!=='ready')throw Error(x.reason);
 assert.deepEqual(x.events.map(e=>e.priority),['B','A']);
 assert.equal(x.planRevisionId,'rev-4');
 assert.equal(x.snapshotVersion,'certified-9');
 assert.equal(x.requiresAthleteApproval,true);
 assert.equal(x.noInventedTrainingDose,true);
 assert.ok(x.unresolved.some(i=>i.code==='MISSING_PHASE_EVIDENCE'));
 assert.equal(x.events[0].name,'Tune-up half marathon');
});
test('signed-out, account switch and stale accepted plan block all Coach season facts',()=>{
 assert.equal(prepareCoachSeasonContext({...input(),authenticatedOwnerId:null}).kind,'blocked');
 assert.equal(prepareCoachSeasonContext({...input(),authenticatedOwnerId:'other'}).kind,'blocked');
 const stale=prepareCoachSeasonContext({...input(),activePlanRevisionId:'rev-5'});
 assert.deepEqual(stale,{kind:'blocked',reason:'stale_revision'});
 assert.equal(prepareCoachSeasonContext({...input(),accessGateReady:false}).kind,'blocked');
});
test('missing and unverified phase previews cannot become Coach training evidence',()=>{
 assert.equal(prepareCoachSeasonContext({...input(),preview:null}).kind,'blocked');
 assert.equal(prepareCoachSeasonContext({...input(),preview:{status:'unavailable',reason:'no_owner',draft:null,phases:null}}).kind,'blocked');
});
test('overlong/unbounded phase output cannot leak into Coach context',()=>{
 const p=preview();
 if(p.status==='unavailable')throw Error('bad fixture');
 p.phases.annotations=Array.from({length:401},()=>({date:'2027-03-20',kind:'taper_review' as const,eventId:'goal',priority:'A' as const}));
 assert.equal(prepareCoachSeasonContext({...input(),preview:p}).kind,'blocked');
 const names=preview();
 if(names.status==='unavailable')throw Error('bad fixture');
 names.draft.events[0].name='x'.repeat(161);
 assert.equal(prepareCoachSeasonContext({...input(),preview:names}).kind,'blocked');
});
