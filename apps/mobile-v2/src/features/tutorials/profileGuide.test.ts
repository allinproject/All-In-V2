import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_GUIDE_VERSION, PROFILE_GUIDE_STEPS,initialGuidePosition,
  guideProgress,advanceGuide,rewindGuide,exitGuide,
} from './profileGuide.ts';

test('Profile walkthrough has distinct steps about current real controls',()=>{
  assert.equal(PROFILE_GUIDE_VERSION,1);
  assert.equal(new Set(PROFILE_GUIDE_STEPS.map(s=>s.id)).size,PROFILE_GUIDE_STEPS.length);
  assert.ok(PROFILE_GUIDE_STEPS.length>=3);
  assert.ok(PROFILE_GUIDE_STEPS.every(step=>step.title&&step.body&&step.target));
  assert.ok(PROFILE_GUIDE_STEPS.every(step=>!step.body.includes('tap Save to continue')));
});
test('next, back, and finish never mutate domain data',()=>{
  const length=PROFILE_GUIDE_STEPS.length;
  let state=initialGuidePosition();
  assert.deepEqual(state,{index:0,done:false});
  state=advanceGuide(state,length);
  assert.deepEqual(state,{index:1,done:false});
  state=rewindGuide(state,length);
  assert.deepEqual(state,{index:0,done:false});
  for(let i=0;i<length;i++)state=advanceGuide(state,length);
  assert.deepEqual(state,{index:length-1,done:true});
  assert.deepEqual(advanceGuide(state,length),state);
  assert.deepEqual(exitGuide(),{index:0,done:false});
});
test('corrupt step indexes are clamped and empty guide is rejected',()=>{
  assert.deepEqual(guideProgress({index:999,done:false},3),{index:2,done:false});
  assert.deepEqual(guideProgress({index:-9,done:false},3),{index:0,done:false});
  assert.throws(()=>guideProgress(initialGuidePosition(),0),/at least one/);
});
