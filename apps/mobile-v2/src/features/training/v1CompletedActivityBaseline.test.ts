import test from 'node:test';
import assert from 'node:assert/strict';
import {V1_COMPLETED_ACTIVITY_BASELINE,v1AllDetailsMetrics,v1SportBaseline} from './v1CompletedActivityBaseline.ts';

test('V1 sport display baseline covers all 17 authoritative sport families',()=>{
 assert.equal(V1_COMPLETED_ACTIVITY_BASELINE.length,17);
 assert.equal(new Set(V1_COMPLETED_ACTIVITY_BASELINE.map(x=>x.sport)).size,17);
 for(const sport of V1_COMPLETED_ACTIVITY_BASELINE){
  assert.ok(sport.overview.length>0,sport.sport+' missing Overview metrics');
  assert.ok(sport.details.length>0,sport.sport+' missing Details metrics');
  assert.equal(new Set(sport.details).size,sport.details.length,'duplicate Details labels in '+sport.sport);
  for(const metric of sport.overview)assert.ok(v1AllDetailsMetrics(sport.sport).includes(metric),'Details cannot omit Overview stat '+metric);
 }
});
test('sport-appropriate metrics and source-conditional rules preserved in baseline',()=>{
 assert.ok(v1AllDetailsMetrics('outdoor_run').includes('Ground contact time'));
 assert.ok(v1AllDetailsMetrics('outdoor_run').includes('Vertical oscillation'));
 assert.ok(v1AllDetailsMetrics('pool_swim').includes('SWOLF'));
 assert.ok(v1AllDetailsMetrics('strength').includes('Completed sets'));
 assert.ok(v1AllDetailsMetrics('indoor_trainer').includes('Power'));
 assert.ok(v1AllDetailsMetrics('ruck').includes('Planned pack weight'));
 assert.equal(v1AllDetailsMetrics('strength').includes('Average Pace'),false);
 assert.equal(v1AllDetailsMetrics('indoor_trainer').includes('Distance'),false);
 assert.equal(v1SportBaseline('unknown'),null);
});
test('no scalar baseline should be mistaken for full recorded structured Details coverage',()=>{
 const running=v1SportBaseline('outdoor_run');
 assert.ok(running);
 assert.equal(running.details.some(metric=>metric.toLowerCase()==='splits'),false,
  'Splits are structured records required separately from scalar metrics');
});
