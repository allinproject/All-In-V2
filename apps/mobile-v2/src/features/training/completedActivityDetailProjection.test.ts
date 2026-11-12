import test from 'node:test';
import assert from 'node:assert/strict';
import {metricEvidenceQualityNotice,projectCompletedActivityDetail,type MetricEvidence} from './completedActivityDetailProjection.ts';
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
test('recovered V1 advanced metric families remain in Details for all 17 display sports',()=>{
 // Synthetic *already owner-authorized* evidence; verifies display retention,
 // not sensor acquisition, backend registry publication or sport comparability.
 const cases=[
  ['outdoor_run','run.gct.balance','Ground contact time balance','51%'],
  ['walk','walk.steps','Steps','4500'],
  ['hike','hike.vertical.speed','Vertical speed','450 m/h'],
  ['ruck','ruck.pack.weight','Pack weight','20 lb'],
  ['outdoor_ride','ride.platform.center.offset','Platform center offset','7 mm'],
  ['indoor_trainer','trainer.torque.effectiveness','Torque effectiveness','75%'],
  ['treadmill','treadmill.incline','Incline','5%'],
  ['strength','strength.estimated.1rm','Estimated 1RM','100 kg'],
  ['swim','swim.stroke.rate','Stroke rate','32 spm'],
  ['pool_swim','pool.swolf','SWOLF','35'],
  ['open_water_swim','water.temperature','Water temperature','18 C'],
  ['elliptical','machine.resistance','Resistance','8'],
  ['stairs','stairs.machine.level','Machine level','9'],
  ['hiit','hiit.rounds.reps','Rounds + reps','5 + 14'],
  ['yoga_mobility','yoga.pose.duration','Pose duration','60 s'],
  ['hybrid','hybrid.transition.duration','Transition duration','2 min'],
  ['other','other.recorded.metric','Recorded source metric','2'],
 ] as const;
 for(const [sport,key,label,value] of cases){
  const evidence:MetricEvidence={key,label,value,source:'verified fixture',
   provenance:sport==='strength'?'estimated':'device',quality:'partial',sourceQuality:'trusted'};
  const model=projectCompletedActivityDetail({sport,metrics:[evidence]});
  assert.equal(model.details.length,1,sport);
  assert.equal(model.details[0].key,key,sport);
  assert.equal(model.details[0].quality,'partial',sport);
  assert.equal(model.details[0].sourceQuality,'trusted',sport);
  // Non-default fields still appear within Details and never produce fake
  // unrelated sport data. Overview remains V1-priority unless pinned.
  assert.equal(model.details.some(x=>x.key!==key),false,sport);
  const absent=projectCompletedActivityDetail({sport,metrics:[]});
  assert.equal(absent.details.length,0,sport);
 }
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

test('user can promote a true non-default Details metric to Overview, without filling Overview with every field',()=>{
 const metrics=[fact('distance','Distance','8 mi'),fact('zone2','Zone 2 time','40 min'),fact('cadence','Cadence','174 spm')];
 const normal=projectCompletedActivityDetail({sport:'outdoor_run',metrics});
 assert.deepEqual(normal.overview.map(x=>x.key),['distance']);
 const customized=projectCompletedActivityDetail({sport:'outdoor_run',metrics,
  overviewLayout:{order:['cadence','distance','zone2'],pinned:['zone2'],hidden:[]}});
 assert.deepEqual(customized.overview.map(x=>x.key),['zone2','distance']);
 assert.equal(customized.details.length,3);
});

test('visible confidence warnings distinguish partial measurement, provider and estimates',()=>{
 const metric=fact('distance','Distance','8 km');
 assert.equal(metricEvidenceQualityNotice(metric),null);
 assert.equal(metricEvidenceQualityNotice({...metric,quality:'trusted',sourceQuality:'trusted'}),null);
 assert.equal(metricEvidenceQualityNotice({...metric,quality:'partial',sourceQuality:'trusted'}),
  'Partial measurement quality');
 assert.equal(metricEvidenceQualityNotice({...metric,quality:'trusted',sourceQuality:'partial'}),
  'Partial source quality');
 assert.equal(metricEvidenceQualityNotice({...metric,quality:'partial',sourceQuality:'partial'}),
  'Partial measurement and source quality');
 assert.equal(metricEvidenceQualityNotice({...metric,provenance:'estimated'}),
  'Estimated value');
 const projected=projectCompletedActivityDetail({sport:'outdoor_run',
  metrics:[{...metric,quality:'partial',sourceQuality:'trusted'}]});
 assert.equal(metricEvidenceQualityNotice(projected.details[0]),'Partial measurement quality');
});
