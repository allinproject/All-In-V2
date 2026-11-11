import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { V2_TUTORIAL_CATALOG, tutorialLaunchRoute } from './tutorialCatalog.ts';
import { PROFILE_GUIDE_STEPS } from './profileGuide.ts';
import { SPORTS_GUIDE_STEPS } from './sportsGuide.ts';
import { KITCHEN_GUIDE_STEPS } from './kitchenGuide.ts';
import { COACH_PREFERENCES_GUIDE_STEPS } from './coachPreferencesGuide.ts';

function source(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const guides=[
  {
    id:'profile-settings', route:'/profile?tutorial=profile-settings', file:'../../../app/profile.tsx',
    steps:PROFILE_GUIDE_STEPS,
    anchor:(target)=>target==='sports'||target==='kitchen'||target==='coach'
      ? `onPersonalizeChildLayout("${target}")`
      : `onGuideAnchorLayout("${target}")`,
  },
  {
    id:'sports-interests', route:'/profile/sports?tutorial=sports', file:'../../../app/profile/sports.tsx',
    steps:SPORTS_GUIDE_STEPS, anchor:(target)=>`onTargetLayout('${target}')`,
  },
  {
    id:'kitchen', route:'/profile/kitchen?tutorial=kitchen', file:'../../../app/profile/kitchen.tsx',
    steps:KITCHEN_GUIDE_STEPS, anchor:(target)=>`onGuideLayout('${target}')`,
  },
  {
    id:'coach-preferences', route:'/profile/coach-preferences?tutorial=coach-preferences',
    file:'../../../app/profile/coach-preferences.tsx',
    steps:COACH_PREFERENCES_GUIDE_STEPS, anchor:(target)=>`onGuideLayout('${target}')`,
  },
];

test('each integrated tutorial launches only to its real route with all live anchors mounted',()=>{
  for (const guide of guides) {
    const entry=V2_TUTORIAL_CATALOG.find(item=>item.id===guide.id);
    assert.ok(entry, `missing catalog entry ${guide.id}`);
    assert.equal(tutorialLaunchRoute(entry),guide.route);
    const screen=source(guide.file);
    assert.match(screen, /<GuidedTourPanel\b/, `${guide.id}: mounted panel missing`);
    assert.match(screen, /onPositionChange=\{onGuidePosition(?:Change)?\}/, `${guide.id}: step targeting missing`);
    assert.match(screen, /router\.replace\('\/profile\/tutorials'\)/, `${guide.id}: return to Help missing`);
    assert.match(screen, /gate\.status/, `${guide.id}: auth gate missing`);
    assert.ok(screen.includes('guideTarget') || screen.includes('tourTarget'),`${guide.id}: target highlight missing`);
    for (const step of guide.steps) {
      assert.ok(screen.includes(guide.anchor(step.target)), `${guide.id}: missing live target ${step.target}`);
    }
  }
});

test('help launches tutorials from catalog rather than introducing one-off routes',()=>{
  const help=source('../../../app/profile/tutorials.tsx');
  assert.match(help,/tutorialLaunchRoute\(t\)/);
  assert.doesNotMatch(help,/href="\/profile\?tutorial=/);
  assert.doesNotMatch(help,/href="\/profile\/kitchen\?tutorial=/);
});

test('tutorial controller cannot write user preferences or invoke destructive profile actions',()=>{
  const controller=source('./GuidedTourPanel.tsx');
  assert.doesNotMatch(controller,/supabase|\.rpc\(|signOut\(|onPress=\{save\}/);
  assert.match(controller,/accessibilityRole="button"/);
  assert.match(controller,/onExit/);
});
