import test from 'node:test';
import assert from 'node:assert/strict';
import {COACH_PREFERENCES_GUIDE_VERSION,COACH_PREFERENCES_GUIDE_STEPS,coachPreferencesGuideTarget} from './coachPreferencesGuide.ts';
import {initialGuidePosition,advanceGuide} from './profileGuide.ts';

test('Coach Preferences tutorial matches real saved choices and explicit approval rule',()=>{
 assert.equal(COACH_PREFERENCES_GUIDE_VERSION,1);
 assert.deepEqual(COACH_PREFERENCES_GUIDE_STEPS.map(x=>x.target),['guidance','detail','changes','tone','save']);
 assert.match(COACH_PREFERENCES_GUIDE_STEPS[2].body,/no option allows silently changing/);
 assert.match(COACH_PREFERENCES_GUIDE_STEPS[4].body,/never saves/);
});
test('Coach Preferences guide has safe finish and invalid-position boundaries',()=>{
 let p=initialGuidePosition();
 assert.equal(coachPreferencesGuideTarget(p),'guidance');
 for(let n=0;n<COACH_PREFERENCES_GUIDE_STEPS.length;n++)p=advanceGuide(p,COACH_PREFERENCES_GUIDE_STEPS.length);
 assert.equal(p.done,true);
 assert.equal(coachPreferencesGuideTarget(p),null);
 assert.equal(coachPreferencesGuideTarget({index:900,done:false}),null);
});
