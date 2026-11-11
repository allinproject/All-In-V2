import test from 'node:test';
import assert from 'node:assert/strict';
import {KITCHEN_GUIDE_VERSION,KITCHEN_GUIDE_STEPS,kitchenGuideTarget} from './kitchenGuide.ts';
import {initialGuidePosition,advanceGuide} from './profileGuide.ts';

test('Kitchen tutorial describes canonical real settings and does not change them',()=>{
 assert.equal(KITCHEN_GUIDE_VERSION,1);
 assert.deepEqual(KITCHEN_GUIDE_STEPS.map(x=>x.target),['home','work','constraints','save']);
 assert.match(KITCHEN_GUIDE_STEPS[0].body,/Unknown/);
 assert.match(KITCHEN_GUIDE_STEPS[3].body,/never submits/);
});
test('Kitchen guide gates invalid indexes and completed position',()=>{
 let p=initialGuidePosition();
 assert.equal(kitchenGuideTarget(p),'home');
 for(let n=0;n<KITCHEN_GUIDE_STEPS.length;n++)p=advanceGuide(p,KITCHEN_GUIDE_STEPS.length);
 assert.equal(p.done,true);
 assert.equal(kitchenGuideTarget(p),null);
 assert.equal(kitchenGuideTarget({index:-1,done:false}),null);
});
