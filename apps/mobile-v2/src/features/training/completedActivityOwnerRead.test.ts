import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalActivityToScreenInput,readOwnedCompletedActivity,
 type CanonicalCompletedActivityRead} from './completedActivityOwnerRead.ts';
import {buildCompletedActivityScreenModel} from './completedActivityScreenModel.ts';

const base=():CanonicalCompletedActivityRead=>({
 id:'activity-1',ownerId:'owner-A',version:1,sport:'running',sportSubtype:'road',title:'Morning Run',
 completedAt:'2026-11-11T07:01:00-06:00',primarySourceId:'watch-record',
 sources:[{id:'watch-record',provider:'Apple Watch',quality:'trusted'}],
 definitions:[
  {code:'distance',version:1,displayName:'Distance',canonicalUnit:'m',
   sportScope:['running'],measurementKinds:['source_measured']},
  {code:'zone2',version:1,displayName:'Zone 2 time',canonicalUnit:'s',
   sportScope:['outdoor_run'],measurementKinds:['provider_derived']},
 ],
 metrics:[
  {code:'distance',definitionVersion:1,displayValue:'0',measurementKind:'source_measured',
   sourceId:'watch-record',quality:'trusted'},
  {code:'zone2',definitionVersion:1,displayValue:null,measurementKind:'provider_derived',
   sourceId:'watch-record',quality:'trusted'},
 ],
 sections:[{key:'splits',kind:'splits',title:'Mile splits',sourceId:'watch-record',count:4}],
});
test('one canonical owner read preserves measured zero, omits unknown and keeps source-backed sections',async()=>{
 const data=await readOwnedCompletedActivity('owner-A','activity-1',async()=> 'owner-A',
  async()=>base());
 assert.equal(data.sport,'outdoor_run');
 assert.equal(data.terrain,'road');
 assert.equal(data.metrics.length,1);
 assert.equal(data.metrics[0].value,'0');
 assert.equal(data.metrics[0].provenance,'device');
 assert.equal(data.sections?.[0].title,'Mile splits');
});
test('account switched during asynchronous read fails closed',async()=>{
 let owner='owner-A';
 await assert.rejects(readOwnedCompletedActivity('owner-A','activity-1',
  async()=>owner,async()=>{owner='owner-B';return base();}),/account changed/);
});
test('foreign owner row, wrong activity ID and canceled view fail closed',async()=>{
 assert.throws(()=>canonicalActivityToScreenInput({...base(),ownerId:'other'},'owner-A','activity-1'),/identity/);
 assert.throws(()=>canonicalActivityToScreenInput(base(),'owner-A','wrong'),/identity/);
 let called=false;
 await assert.rejects(readOwnedCompletedActivity('owner-A','activity-1',async()=> 'owner-A',
  async()=>{called=true;return base();},()=>false),/no longer active/);
 assert.equal(called,false);
});
test('unregistered metric, sport mismatch and conflicting duplicate codes fail closed',()=>{
 const a=base();
 assert.throws(()=>canonicalActivityToScreenInput({...a,metrics:[{...a.metrics[0],code:'fake'}]},'owner-A','activity-1'),/definition/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,sport:'strength',sportSubtype:null},'owner-A','activity-1'),/definition/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,metrics:[a.metrics[0],a.metrics[0]]},'owner-A','activity-1'),/Conflicting/);
});
test('unverified measurements are not mislabeled validated, rejected source never displays',()=>{
 const a=base();
 const b=canonicalActivityToScreenInput({...a,metrics:[{...a.metrics[0],quality:'unverified'}]},'owner-A','activity-1');
 assert.equal(b.metrics.length,0);
 assert.throws(()=>canonicalActivityToScreenInput({...a,sources:[{...a.sources[0],quality:'rejected'}]},'owner-A','activity-1'),/source is unavailable/);
});
test('partial metric and provider confidence remain distinguishable from trusted readings',()=>{
 const a=base();
 const fromMetric=canonicalActivityToScreenInput({...a,metrics:[
  {...a.metrics[0],quality:'partial'}
 ]},'owner-A','activity-1');
 assert.equal(fromMetric.metrics.length,1);
 assert.equal(fromMetric.metrics[0].quality,'partial');
 assert.equal(fromMetric.metrics[0].sourceQuality,'trusted');
 assert.equal(fromMetric.metrics[0].value,'0');
 const partialProvider=canonicalActivityToScreenInput({...a,sources:[
  {...a.sources[0],quality:'partial'}
 ],metrics:[a.metrics[0]]},'owner-A','activity-1');
 assert.equal(partialProvider.metrics[0].quality,'trusted');
 assert.equal(partialProvider.metrics[0].sourceQuality,'partial');
 const unverifiedProvider=canonicalActivityToScreenInput({...a,sources:[
  {...a.sources[0],quality:'unverified'}
 ],metrics:[a.metrics[0]]},'owner-A','activity-1');
 assert.equal(unverifiedProvider.metrics.length,0);
});

test('source and source-level sport applicability validated before display',()=>{
 const a=base();
 assert.throws(()=>canonicalActivityToScreenInput({...a,metrics:[{...a.metrics[0],sourceId:'another'}]},'owner-A','activity-1'),/source/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,definitions:[a.definitions[0],a.definitions[0]]},'owner-A','activity-1'),/Duplicate metric/);
});

test('pool and indoor machine activities reject impossible GPS route sections',()=>{
 const section={key:'route',kind:'route' as const,title:'GPS route',sourceId:'watch-record',count:12};
 for(const [sport,sportSubtype] of [
  ['swimming','pool'],['cycling','trainer'],['elliptical','machine'],['stair','stepper']
 ] as const){
  const raw={...base(),sport,sportSubtype,metrics:[],sections:[section]};
  assert.throws(()=>canonicalActivityToScreenInput(raw,'owner-A','activity-1'),
   /Route evidence is incompatible/,sport+' '+sportSubtype);
 }
});

test('authentic outdoor route evidence remains allowed where the sport supports routes',()=>{
 const section={key:'route',kind:'route' as const,title:'GPS route',sourceId:'watch-record',count:12};
 for(const [sport,sportSubtype] of [
  ['running','trail'],['cycling','outdoor'],['swimming','open_water']
 ] as const){
  const raw={...base(),sport,sportSubtype,metrics:[],sections:[section]};
  const read=canonicalActivityToScreenInput(raw,'owner-A','activity-1');
  assert.equal(read.sections?.[0].kind,'route');
 }
});

test('sport-specific structured sets and transitions cannot cross activity identities',()=>{
 const invalid=[
  {sport:'running',sportSubtype:'road',kind:'swim_sets'},
  {sport:'swimming',sportSubtype:'pool',kind:'strength_sets'},
  {sport:'cycling',sportSubtype:'outdoor',kind:'transitions'},
  {sport:'running',sportSubtype:'trail',kind:'sport_legs'},
 ] as const;
 for(const item of invalid){
  const raw={...base(),sport:item.sport,sportSubtype:item.sportSubtype,metrics:[],sections:[
   {key:'section',kind:item.kind,title:'Recorded structure',sourceId:'watch-record',count:2}]};
  assert.throws(()=>canonicalActivityToScreenInput(raw,'owner-A','activity-1'),
   /Structured evidence is incompatible/,item.sport+' '+item.kind);
 }
});

test('genuine sport-specific and multisport structured evidence remain visible',()=>{
 const allowed=[
  {sport:'strength',sportSubtype:'gym',kind:'strength_sets'},
  {sport:'swimming',sportSubtype:'pool',kind:'swim_sets'},
  {sport:'multisport',sportSubtype:'triathlon',kind:'sport_legs'},
  {sport:'multisport',sportSubtype:'triathlon',kind:'transitions'},
  {sport:'multisport',sportSubtype:'hybrid',kind:'swim_sets'},
  {sport:'hiit',sportSubtype:'gym',kind:'strength_sets'},
 ] as const;
 for(const item of allowed){
  const raw={...base(),sport:item.sport,sportSubtype:item.sportSubtype,metrics:[],sections:[
   {key:'section',kind:item.kind,title:'Recorded structure',sourceId:'watch-record',count:2}]};
  assert.equal(canonicalActivityToScreenInput(raw,'owner-A','activity-1').sections?.[0].kind,
   item.kind,item.sport+' '+item.kind);
 }
});

test('all 15 canonical sports carry real owner metrics into V1 Overview and Details',()=>{
 const supported=[
  ['running','trail'],['walking','road'],['hiking','trail'],['rucking','trail'],
  ['cycling','trainer'],['swimming','pool'],['strength','gym'],['rowing','machine'],
  ['elliptical','machine'],['stair','stepper'],['yoga','studio'],['mobility','studio'],
  ['hiit','gym'],['multisport','triathlon'],['other',''],
 ] as const;
 for(const [sport,sportSubtype] of supported){
  const raw:CanonicalCompletedActivityRead={...base(),sport,sportSubtype,
   definitions:[{code:'duration',version:1,displayName:'Duration',canonicalUnit:'s',
    sportScope:[sport],measurementKinds:['source_measured']}],
   metrics:[{code:'duration',definitionVersion:1,displayValue:'1800 s',
    measurementKind:'source_measured',sourceId:'watch-record',quality:'trusted'}],
   sections:[],
  };
  const owned=canonicalActivityToScreenInput(raw,'owner-A','activity-1');
  const screen=buildCompletedActivityScreenModel(owned);
  assert.deepEqual(screen.tabs,['Overview','Details','Coach'],sport);
  assert.deepEqual(screen.stats.overview.map(m=>m.key),['duration'],sport);
  assert.deepEqual(screen.stats.details.map(m=>m.key),['duration'],sport);
  assert.equal(screen.stats.details[0].provenance,'device',sport);
  assert.equal(screen.stats.details[0].quality,'trusted',sport);
  assert.equal(screen.stats.sections.length,0,sport);
 }
});

test('untrusted runtime enums and ambiguous numeric placeholders fail closed',()=>{
 const a=base();
 assert.throws(()=>canonicalActivityToScreenInput({...a,sources:[{...a.sources[0],quality:'invented' as 'trusted'}]},'owner-A','activity-1'),/Invalid or duplicate canonical source/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,metrics:[{...a.metrics[0],measurementKind:'unknown' as 'source_measured'}]},'owner-A','activity-1'),/source or definition/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,metrics:[{...a.metrics[0],displayValue:'NaN'}]},'owner-A','activity-1'),/Invalid source-backed/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,sections:[{...a.sections![0],kind:'unknown' as 'splits'}]},'owner-A','activity-1'),/Structured activity evidence/);
 assert.throws(()=>canonicalActivityToScreenInput({...a,definitions:[{...a.definitions[0],measurementKinds:['unknown' as 'source_measured']}]},'owner-A','activity-1'),/Invalid metric registry/);
});
