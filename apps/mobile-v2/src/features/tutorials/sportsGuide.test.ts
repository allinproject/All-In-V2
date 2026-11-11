import test from 'node:test';
import assert from 'node:assert/strict';
import {SPORTS_GUIDE_STEPS,SPORTS_GUIDE_VERSION,sportsGuideTarget} from './sportsGuide.ts';
import {advanceGuide,initialGuidePosition} from './profileGuide.ts';

test('Sports guide targets real independently controlled sections without domain mutations',()=>{
  assert.equal(SPORTS_GUIDE_VERSION,1);
  assert.deepEqual(SPORTS_GUIDE_STEPS.map(s=>s.target),['focus','activities','save']);
  assert.ok(SPORTS_GUIDE_STEPS.every(s=>s.title&&s.body));
  assert.match(SPORTS_GUIDE_STEPS[2].body,/never saves/);
});
test('Sports guide supports back, finish and safe reset using shared step controller',()=>{
  let state=initialGuidePosition();
  assert.equal(sportsGuideTarget(state),'focus');
  state=advanceGuide(state,SPORTS_GUIDE_STEPS.length);
  assert.equal(sportsGuideTarget(state),'activities');
  state=advanceGuide(state,SPORTS_GUIDE_STEPS.length);
  assert.equal(sportsGuideTarget(state),'save');
  state=advanceGuide(state,SPORTS_GUIDE_STEPS.length);
  assert.equal(state.done,true);
  assert.equal(sportsGuideTarget(state),null);
  assert.equal(sportsGuideTarget({index:999,done:false}),null);
});
