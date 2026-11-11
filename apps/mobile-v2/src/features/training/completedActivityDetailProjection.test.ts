import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCompletedActivityDetail,type MetricEvidence} from './completedActivityDetailProjection.ts';
const fact=(key:string,label:string,value:string):MetricEvidence=>
 ({key,label,value,provenance:'device',source:'watch'});
test('details preserves every supplied metric, including extended measurements outside 17-sport scalar baseline',()=>{
 const metrics=[fact('run.hr','Average HR','140 bpm'),fact('run.distance','Distance','8 mi'),
  fact('run.zone2','Zone 2 time','48 min'),fact('run.gct','Ground contact time','247 ms')];
 const sections=[{key:'splits',kind:'splits' as const,title:'Mile splits',source:'watch',count:8},
  {key:'hr',kind:'heart_rate_series' as const,title:'Heart-rate trace',source:'watch',count:450}];
 const p=projectCompletedActivityDetail({sport:'outdoor_run',metrics,sections});
 assert.deepEqual(p.overview.map(x=>x.key),['run.distance','run.hr']);
 assert.equal(p.details.length,4);
 assert.deepEqual(p.additionalMetricKeys,['run.zone2']);
 assert.deepEqual(p.sections.map(x=>x.key),['splits','hr']);
});
test('no fabricated metrics and no unsupported structures when missing',()=>{
 const p=projectCompletedActivityDetail({sport:'pool_swim',metrics:[fact('swim.distance','Distance','1000 m')]});
 assert.deepEqual(p.details.map(x=>x.key),['swim.distance']);
 assert.equal(p.sections.length,0);
 assert.equal(p.details.some(x=>x.label==='SWOLF'),false);
 assert.deepEqual(p.hiddenMetricKeys,[]);
});
test('customization never rewrites source data; optional hidden fields remain known',()=>{
 const metrics=[fact('speed','Average Speed','27 km/h'),fact('power','Power','210 W'),
  {...fact('source','Source','Garmin'),required:true}];
 const p=projectCompletedActivityDetail({sport:'outdoor_ride',metrics,detailsLayout:{
  order:['source','power'],pinned:['power'],hidden:['speed','source'],
 }});
 assert.deepEqual(p.details.map(x=>x.key),['power','source']);
 assert.deepEqual(p.hiddenMetricKeys,['speed']);
 assert.equal(metrics.length,3);
 assert.equal(metrics[0].value,'27 km/h');
});
test('structured evidence is bounded, source-attested and idempotently keyed',()=>{
 const metrics=[fact('duration','Duration','40 min')];
 const p=projectCompletedActivityDetail({sport:'strength',metrics,sections:[
  {key:'strength',kind:'strength_sets',title:'Completed sets',source:'session',count:12},
  {key:'missing',kind:'strength_sets',title:'',source:'session',count:0},
 ]});
 assert.deepEqual(p.sections.map(x=>x.key),['strength']);
 assert.throws(()=>projectCompletedActivityDetail({sport:'strength',metrics,sections:[
  {key:'a',kind:'strength_sets',title:'Sets',source:'session',count:1},
  {key:'a',kind:'strength_sets',title:'Other',source:'session',count:2},
 ]}),/Duplicate structured section/);
});
test('rejects unresolved conflicting metric evidence and unknown sport',()=>{
 assert.throws(()=>projectCompletedActivityDetail({sport:'outdoor_run',metrics:[
  fact('distance','Distance','5 mi'),fact('distance','Distance','6 mi'),
 ]}),/Conflicting canonical metric/);
 assert.throws(()=>projectCompletedActivityDetail({sport:'nonexistent',metrics:[]}),/no approved display policy/);
});
test('invalid or unavailable measurements never become a fake recorded zero',()=>{
 const p=projectCompletedActivityDetail({sport:'elliptical',metrics:[
  fact('heart_rate','Average HR',''),
  {...fact('distance','Distance','0 km'),source:''},
  {...fact('workload','Resistance','8'),provenance:'manual'},
 ]});
 assert.deepEqual(p.details.map(x=>x.key),['workload']);
});
