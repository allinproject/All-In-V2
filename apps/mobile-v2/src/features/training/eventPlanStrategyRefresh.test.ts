import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEventStrategySourceRefresh,reviewEventStrategyGenerationReceipt,type StrategyEventRef,type EventStrategySnapshot,type StrategySourceRevision} from './eventPlanStrategyRefresh.ts';
const expected:StrategyEventRef={ownerId:'owner-1',eventId:'race-1',editionId:'race-2027',eventVersion:2};
const current:EventStrategySnapshot={...expected,strategyRevision:3,sourceRevision:5,courseVersion:'course-v1'};
const incoming:StrategySourceRevision={...expected,sourceRevision:6,courseVersion:'course-v1',evidenceState:'verified'};
const decide=(next:StrategySourceRevision|null=incoming,prior:EventStrategySnapshot|null=current)=>
  reviewEventStrategySourceRefresh({expected,current:prior,incoming:next});
test('verified new source requests only advisory refresh, never a Training write',()=>{
  assert.deepEqual(decide(),{
    status:'refresh_advice',reason:'new_source',
    invalidateCourseDependentAdvice:false,requiresTrainingApproval:true,
  });
  assert.deepEqual(decide({...incoming,courseVersion:'course-v2'}),{
    status:'refresh_advice',reason:'course_changed',
    invalidateCourseDependentAdvice:true,requiresTrainingApproval:true,
  });
});
test('unchanged source avoids refresh thrash',()=>{
 assert.deepEqual(decide({...incoming,sourceRevision:5}),{status:'current',reason:'same_source'});
});
test('foreign owner, event, edition or stale event revision blocks refresh',()=>{
 for(const change of [
   {ownerId:'another'},{eventId:'race-2'},
   {editionId:'race-2028'},{eventVersion:3}
 ]) assert.equal(decide({...incoming,...change}).status,'unavailable');
 assert.equal(decide(null).status,'unavailable');
});
test('source conflicts and regressed versions never auto replace accepted advice',()=>{
 for(const state of ['partial','unverified','conflict'] as const)
   assert.deepEqual(decide({...incoming,evidenceState:state}),{
     status:'source_review_required',reason:'unverified_or_conflicting_source',
   });
 assert.deepEqual(decide({...incoming,sourceRevision:4}),{
   status:'source_review_required',reason:'source_revision_regressed',
 });
 assert.equal(decide({...incoming,sourceRevision:5,courseVersion:'course-v2'}).status,'source_review_required');
});
test('malformed or unversioned evidence fails closed',()=>{
 assert.equal(decide({...incoming,sourceRevision:0}).status,'unavailable');
 assert.equal(decide({...incoming,courseVersion:''}).status,'unavailable');
 assert.equal(decide(incoming,{...current,strategyRevision:0}).status,'unavailable');
});

test('late Coach response is rejected after course or source revision advances',()=>{
  const receipt={...expected,basedOnStrategyRevision:3,basedOnSourceRevision:6,basedOnCourseVersion:'course-v1',adviceText:'Updated effort guidance'};
  assert.deepEqual(reviewEventStrategyGenerationReceipt({expected,current,latestSource:incoming,receipt}),{
    status:'review_ready',adviceText:'Updated effort guidance',requiresTrainingApproval:true,
  });
  assert.deepEqual(reviewEventStrategyGenerationReceipt({
    expected,current,latestSource:{...incoming,sourceRevision:7},receipt,
  }),{status:'stale',reason:'source_changed'});
  assert.deepEqual(reviewEventStrategyGenerationReceipt({
    expected,current,latestSource:{...incoming,courseVersion:'course-v2'},receipt,
  }),{status:'stale',reason:'source_changed'});
});
test('late Coach response cannot overwrite newer generated strategy or another event',()=>{
  const receipt={...expected,basedOnStrategyRevision:3,basedOnSourceRevision:6,basedOnCourseVersion:'course-v1',adviceText:'Advice'};
  const updated=reviewEventStrategyGenerationReceipt({
    expected,current:{...current,strategyRevision:4},
    latestSource:incoming,receipt,
  });
  assert.deepEqual(updated,{status:'stale',reason:'strategy_advanced'});
  for(const change of [{ownerId:'other'},{eventId:'other'},{editionId:'2028'},{eventVersion:4}]){
    assert.equal(reviewEventStrategyGenerationReceipt({
      expected,current,latestSource:incoming,receipt:{...receipt,...change},
    }).status,'unavailable');
  }
});
test('unverified source or empty advice is never review ready',()=>{
  const receipt={...expected,basedOnStrategyRevision:3,basedOnSourceRevision:6,basedOnCourseVersion:'course-v1',adviceText:'Ready'};
  assert.equal(reviewEventStrategyGenerationReceipt({
    expected,current,latestSource:{...incoming,evidenceState:'conflict'},receipt,
  }).status,'unavailable');
  assert.equal(reviewEventStrategyGenerationReceipt({
    expected,current,latestSource:incoming,receipt:{...receipt,adviceText:' '},
  }).status,'unavailable');
});
