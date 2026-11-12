import test from 'node:test';
import assert from 'node:assert/strict';
import {isCanonicalActivitySport,resolveActivityPresentationSport as resolve} from './completedActivitySportAdapter.ts';
test('road and trail remain metadata, not launch prompts or different canonical sports',()=>{
 assert.deepEqual(resolve('running','road'),{sport:'outdoor_run',terrain:'road',fallback:false});
 assert.deepEqual(resolve('running','trail'),{sport:'outdoor_run',terrain:'trail',fallback:false});
 assert.deepEqual(resolve('running'),{sport:'outdoor_run',terrain:null,fallback:false});
});
test('bike indoor/outdoor and swimming pool/open-water never share incompatible layouts',()=>{
 assert.equal(resolve('cycling','trainer').sport,'indoor_trainer');
 assert.equal(resolve('cycling','outdoor').sport,'outdoor_ride');
 assert.equal(resolve('swimming','pool').sport,'pool_swim');
 assert.equal(resolve('swimming','open_water').sport,'open_water_swim');
 assert.equal(resolve('swimming').sport,'swim');
});
test('every supported canonical V2 sport has a defined screen; rowing fallback is honest',()=>{
 const sports=['running','walking','hiking','rucking','cycling','swimming','strength','rowing',
  'elliptical','stair','yoga','mobility','hiit','multisport','other'];
 for(const sport of sports)assert.ok(resolve(sport).sport,sport);
 assert.deepEqual(resolve('rowing','machine'),{sport:'other',terrain:null,fallback:true});
});
test('subtype mismatch cannot silently reclassify an activity',()=>{
 assert.throws(()=>resolve('running','pool'),/Unsupported activity sport/);
 assert.throws(()=>resolve('swimming','treadmill'),/Unsupported activity sport/);
 assert.throws(()=>resolve('cycling','trail_run'),/Unsupported activity sport/);
 assert.throws(()=>resolve('rowing','bike'),/Unsupported activity sport/);
});

test('approved HIIT and one-parent multisport stay distinct from generic activity',()=>{
 assert.deepEqual(resolve('hiit'),{sport:'hiit',terrain:null,fallback:false});
 assert.deepEqual(resolve('multisport','triathlon'),{sport:'hybrid',terrain:null,fallback:false});
 assert.deepEqual(resolve('multisport','brick'),{sport:'hybrid',terrain:null,fallback:false});
 assert.throws(()=>resolve('multisport','treadmill'),/Unsupported activity sport/);
 assert.throws(()=>resolve('hiit','pool'),/Unsupported activity sport/);
});

test('only database canonical sport IDs qualify as metric registry scopes',()=>{
 for(const sport of ['running','walking','hiking','rucking','cycling','swimming','strength','rowing',
  'elliptical','stair','yoga','mobility','hiit','multisport','other'])
  assert.equal(isCanonicalActivitySport(sport),true,sport);
 for(const sport of ['outdoor_run','pool_swim','indoor_trainer','hybrid','all','__proto__','constructor','toString'])
  assert.equal(isCanonicalActivitySport(sport),false,sport);
 assert.throws(()=>resolve('__proto__'),/Unsupported activity sport/);
 assert.throws(()=>resolve('constructor'),/Unsupported activity sport/);
});
