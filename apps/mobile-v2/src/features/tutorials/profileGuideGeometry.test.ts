import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGuideLayoutRegistry, guideTargetOffset } from './profileGuideGeometry.ts';

test('nested target requires both parent and child measurements regardless of event order',()=>{
  const r=emptyGuideLayoutRegistry();
  assert.equal(guideTargetOffset(r,'kitchen'),null);
  r.children.kitchen=195;
  assert.equal(guideTargetOffset(r,'kitchen'),null);
  r.sections.nutrition=320;
  assert.equal(guideTargetOffset(r,'kitchen'),499);
  const reversed=emptyGuideLayoutRegistry();
  reversed.sections.nutrition=320;
  assert.equal(guideTargetOffset(reversed,'kitchen'),null);
  reversed.children.kitchen=195;
  assert.equal(guideTargetOffset(reversed,'kitchen'),499);
});
test('target offset uses the true section location and clamps safe scrolling',()=>{
  const r=emptyGuideLayoutRegistry();
  r.sections.account=0;
  r.sections.help=700;
  r.sections.legal=1000;
  assert.equal(guideTargetOffset(r,'account'),0);
  assert.equal(guideTargetOffset(r,'help'),684);
  assert.equal(guideTargetOffset(r,'legal'),984);
  assert.equal(guideTargetOffset(r,null),null);
  assert.equal(guideTargetOffset(r,'coach'),null);
});
test('invalid coordinates never scroll to an accidental fallback',()=>{
  const r=emptyGuideLayoutRegistry();
  r.sections.personalize=NaN;
  r.children.coach=300;
  assert.equal(guideTargetOffset(r,'coach'),null);
  r.sections.personalize=100;
  r.children.coach=-900;
  assert.equal(guideTargetOffset(r,'coach'),null);
  r.children.coach=0;
  assert.equal(guideTargetOffset(r,'coach',Infinity),100);
});

test('Kitchen lives under Nutrition while Sports and Coach remain under Training',()=>{
 const r=emptyGuideLayoutRegistry();
 r.sections.personalize=200;r.sections.nutrition=700;
 r.children.sports=50;r.children.coach=300;r.children.kitchen=100;
 assert.equal(guideTargetOffset(r,'sports'),234);
 assert.equal(guideTargetOffset(r,'coach'),484);
 assert.equal(guideTargetOffset(r,'kitchen'),784);
});
