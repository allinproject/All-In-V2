import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY_LAYOUT,readCompletedActivityLayouts,readMetricLayout,completedActivityLayoutPatch,
 updateMetricLayout,resetMetricLayout,toggleMetricHidden,toggleMetricPin,moveMetric,presentMetrics}
 from './completedActivityLayouts.ts';
const stats=[{key:'pace',label:'Average Pace'},{key:'heart_rate',label:'Heart Rate'},
 {key:'provenance',label:'Source',required:true},{key:'cadence',label:'Cadence'}];

test('separate sport and completed activity tab preferences',()=>{
 let all={};
 all=updateMetricLayout(all,'outdoor_run','details',{order:['heart_rate','pace'],pinned:['heart_rate'],hidden:['cadence']});
 assert.deepEqual(readMetricLayout(all,'outdoor_run','overview'),EMPTY_LAYOUT);
 assert.deepEqual(readMetricLayout(all,'outdoor_ride','details'),EMPTY_LAYOUT);
 assert.equal(readMetricLayout(all,'outdoor_run','details').pinned[0],'heart_rate');
 assert.deepEqual(readCompletedActivityLayouts({app_preferences:completedActivityLayoutPatch(all)}),all);
 all=resetMetricLayout(all,'outdoor_run','details');
 assert.deepEqual(readMetricLayout(all,'outdoor_run','details'),EMPTY_LAYOUT);
});
test('pin, reorder and hide only affect view; required provenance always shown',()=>{
 let layout={...EMPTY_LAYOUT};
 layout=toggleMetricPin(layout,'heart_rate',stats);
 layout=toggleMetricHidden(layout,'cadence',stats);
 layout=moveMetric(layout,'pace','down',stats);
 assert.deepEqual(presentMetrics(stats,layout).map(x=>x.key),['heart_rate','pace','provenance']);
 assert.deepEqual(stats.map(x=>x.key),['pace','heart_rate','provenance','cadence']);
 assert.throws(()=>toggleMetricHidden(layout,'provenance',stats),/cannot be hidden/);
 const edited={...layout,hidden:[...layout.hidden,'provenance']};
 assert.equal(presentMetrics(stats,edited).some(x=>x.key==='provenance'),true);
});
test('available source-backed data, not layout preferences, determines visibility',()=>{
 const layout={order:['nonexistent','heart_rate'],pinned:['nonexistent','heart_rate'],hidden:[]};
 const only=[{key:'pace',label:'Pace'}];
 assert.deepEqual(presentMetrics(only,layout).map(x=>x.key),['pace']);
 assert.throws(()=>toggleMetricPin(EMPTY_LAYOUT,'nonexistent',only),/not available/);
});
