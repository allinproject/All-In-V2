import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompletedActivityScreenModel} from './completedActivityScreenModel.ts';
const metric=(key:string,label:string,value:string)=>({key,label,value,source:'canonical-source',provenance:'device' as const});
test('V1 Overview Details Coach tabs are fixed and all supplied stats stay in Details',()=>{
 const model=buildCompletedActivityScreenModel({
  id:'activity-1',sport:'outdoor_run',terrain:'trail',title:'Morning Run',completedAt:'2026-11-11T06:30:00',
  sourceLabel:'Apple Watch',metrics:[metric('distance','Distance','8 mi'),metric('pace','Average Pace','9:30/mi'),
   metric('hr.zone2','Zone 2 time','43 min'),metric('gct','Ground contact time','244 ms')],
 });
 assert.deepEqual(model.tabs,['Overview','Details','Coach']);
 assert.equal(model.terrain,'trail');
 assert.deepEqual(model.stats.overview.map(x=>x.key),['distance','pace']);
 assert.deepEqual(model.stats.details.map(x=>x.key),['distance','pace','gct','hr.zone2']);
 assert.equal(model.customization.details.length,4);
 assert.equal(model.customization.overview.length,4);
 assert.equal(model.coach,null);
});
test('source-backed structured data is exposed without inventing missing measurements',()=>{
 const model=buildCompletedActivityScreenModel({
  id:'activity-2',sport:'strength',title:'Strength',completedAt:'2026-11-11',sourceLabel:'Manual',
  metrics:[metric('sets','Completed sets','12')],sections:[
   {key:'recorded-sets',kind:'strength_sets',title:'Exercise sets',source:'training',count:12},
  ],coach:{summary:'Recorded 12 sets.',reasons:['Exercise data available.'],source:'verified_rule'},
 });
 assert.equal(model.stats.sections.length,1);
 assert.equal(model.stats.details.length,1);
 assert.equal(model.coach?.summary,'Recorded 12 sets.');
 assert.equal(model.stats.details.some(x=>x.label==='Average Pace'),false);
});
test('customization can hide optional data but never suppress source-required fields',()=>{
 const model=buildCompletedActivityScreenModel({
  id:'activity-3',sport:'outdoor_ride',title:'Ride',completedAt:'2026-11-11',sourceLabel:'Imported',
  metrics:[metric('speed','Average Speed','30 km/h'),{...metric('source','Source','Imported'),required:true}],
  detailsLayout:{order:[],pinned:[],hidden:['speed','source']},
 });
 assert.deepEqual(model.stats.details.map(x=>x.key),['source']);
 assert.deepEqual(model.stats.hiddenMetricKeys,['speed']);
 assert.equal(model.customization.details.length,2);
});
test('Overview and Details retain partial metric and provider quality for honest UI labeling',()=>{
 const model=buildCompletedActivityScreenModel({
  id:'partial-activity',sport:'outdoor_run',title:'Run',completedAt:'2026-11-11T09:00:00Z',
  sourceLabel:'Watch',metrics:[
   {...metric('distance','Distance','8 mi'),quality:'partial',sourceQuality:'trusted'},
   {...metric('hr','Average HR','145 bpm'),quality:'trusted',sourceQuality:'partial'},
  ],
 });
 assert.equal(model.stats.details.length,2);
 assert.equal(model.stats.overview.length,2);
 assert.equal(model.stats.details[0].quality,'partial');
 assert.equal(model.stats.details[1].sourceQuality,'partial');
 assert.equal(model.stats.overview[0].quality,'partial');
 assert.equal(model.stats.overview[1].sourceQuality,'partial');
});

test('no activity with missing title/source or unsupported sport is accepted',()=>{
 assert.throws(()=>buildCompletedActivityScreenModel({
  id:'a',sport:'outdoor_run',title:'',completedAt:'date',sourceLabel:'Source',metrics:[],
 }),/identity or source/);
 assert.throws(()=>buildCompletedActivityScreenModel({
  id:'a',sport:'mystery',title:'Run',completedAt:'date',sourceLabel:'Source',metrics:[],
 }),/not recognized/);
});
