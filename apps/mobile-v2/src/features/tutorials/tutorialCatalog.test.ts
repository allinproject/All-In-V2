import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V2_TUTORIAL_CATALOG,canStartTutorial,publishedTutorials,
  tutorialCatalogCategories,isExploreRoute,tutorialLaunchRoute,type TutorialEntry,
} from './tutorialCatalog.ts';

test('catalog has stable, unique tutorial ids and ordered categories',()=>{
  assert.equal(new Set(V2_TUTORIAL_CATALOG.map(x=>x.id)).size,V2_TUTORIAL_CATALOG.length);
  assert.deepEqual(tutorialCatalogCategories().slice(0,2),['Getting started','Training']);
  assert.ok(V2_TUTORIAL_CATALOG.some(x=>x.id==='weekly-routine'));
  assert.ok(V2_TUTORIAL_CATALOG.some(x=>x.id==='coach-learning'));
});
test('the V2 catalog does not claim placeholder workspaces have usable tutorials',()=>{
  assert.deepEqual(publishedTutorials(),[]);
  assert.deepEqual(V2_TUTORIAL_CATALOG.filter(canStartTutorial).map(t=>t.id),['profile-settings','sports-interests','kitchen','coach-preferences']);
  assert.ok(V2_TUTORIAL_CATALOG.filter(t=>!['profile-settings','sports-interests','kitchen','coach-preferences'].includes(t.id)).every(t=>!canStartTutorial(t)));
});
test('tutorial readiness gates are not equivalent to working screen links',()=>{
  const entry: TutorialEntry={id:'example',title:'Example',category:'Training',summary:'Sample',
    readiness:'planned',exploreRoute:'/train'};
  assert.equal(canStartTutorial(entry),false);
  assert.equal(isExploreRoute(entry.exploreRoute),true);
  assert.equal(canStartTutorial({...entry,readiness:'coded'}),false);
  assert.equal(canStartTutorial({...entry,readiness:'integrated'}),false);
  assert.equal(tutorialLaunchRoute({...entry,readiness:'integrated'}),null);
  assert.equal(canStartTutorial({...entry,readiness:'integrated',launchRoute:'/profile?tutorial=profile-settings'}),true);
  assert.equal(publishedTutorials([{...entry,readiness:'integrated'}]).length,0);
  assert.equal(publishedTutorials([{...entry,readiness:'device_validated'}]).length,0);
  assert.equal(publishedTutorials([{...entry,readiness:'device_validated',launchRoute:'/profile?tutorial=profile-settings'}]).length,1);
});
test('only explicitly reviewed routes may be explored from tutorial catalog',()=>{
  assert.equal(isExploreRoute('/profile/kitchen'),true);
  assert.equal(isExploreRoute('/profile/coach-preferences'),true);
  assert.equal(isExploreRoute('/coach'),false);
  assert.equal(isExploreRoute('/meal-prep'),false);
  assert.equal(isExploreRoute('https://example.com'),false);
});

test('integrated V2 guides have one canonical launch target and no planned guide gets a launch route',()=>{
  const available=V2_TUTORIAL_CATALOG.filter(canStartTutorial);
  assert.equal(available.length,4);
  assert.deepEqual(available.map(t=>tutorialLaunchRoute(t)),[
    '/profile?tutorial=profile-settings',
    '/profile/sports?tutorial=sports',
    '/profile/kitchen?tutorial=kitchen',
    '/profile/coach-preferences?tutorial=coach-preferences',
  ]);
  assert.equal(new Set(available.map(t=>t.launchRoute)).size,available.length);
  assert.ok(V2_TUTORIAL_CATALOG.filter(t=>t.readiness==='planned').every(t=>tutorialLaunchRoute(t)===null));
});
