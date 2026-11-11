import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V2_TUTORIAL_CATALOG,canStartTutorial,publishedTutorials,
  tutorialCatalogCategories,isExploreRoute,type TutorialEntry,
} from './tutorialCatalog.ts';

test('catalog has stable, unique tutorial ids and ordered categories',()=>{
  assert.equal(new Set(V2_TUTORIAL_CATALOG.map(x=>x.id)).size,V2_TUTORIAL_CATALOG.length);
  assert.deepEqual(tutorialCatalogCategories().slice(0,2),['Getting started','Training']);
  assert.ok(V2_TUTORIAL_CATALOG.some(x=>x.id==='weekly-routine'));
  assert.ok(V2_TUTORIAL_CATALOG.some(x=>x.id==='coach-learning'));
});
test('the V2 catalog does not claim placeholder workspaces have usable tutorials',()=>{
  assert.deepEqual(publishedTutorials(),[]);
  assert.ok(V2_TUTORIAL_CATALOG.every(t=>!canStartTutorial(t)));
});
test('tutorial readiness gates are not equivalent to working screen links',()=>{
  const entry: TutorialEntry={id:'example',title:'Example',category:'Training',summary:'Sample',
    readiness:'planned',exploreRoute:'/train'};
  assert.equal(canStartTutorial(entry),false);
  assert.equal(isExploreRoute(entry.exploreRoute),true);
  assert.equal(canStartTutorial({...entry,readiness:'coded'}),false);
  assert.equal(canStartTutorial({...entry,readiness:'integrated'}),true);
  assert.equal(publishedTutorials([{...entry,readiness:'integrated'}]).length,0);
  assert.equal(publishedTutorials([{...entry,readiness:'device_validated'}]).length,1);
});
test('only explicitly reviewed routes may be explored from tutorial catalog',()=>{
  assert.equal(isExploreRoute('/profile/kitchen'),true);
  assert.equal(isExploreRoute('/profile/coach-preferences'),true);
  assert.equal(isExploreRoute('/coach'),false);
  assert.equal(isExploreRoute('/meal-prep'),false);
  assert.equal(isExploreRoute('https://example.com'),false);
});
