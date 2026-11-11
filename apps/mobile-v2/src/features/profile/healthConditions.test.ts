import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY_HEALTH_DRAFT,addHealthFact,removeHealthFact,normalizeHealthFact,MAX_FACT_LENGTH,parseSavedHealthConsiderations,healthConsiderationsPayload} from './healthConditions.ts';

test('health draft remains explicit, empty and separate from food allergies',()=>{
 assert.deepEqual(EMPTY_HEALTH_DRAFT,{conditions:[],limitations:[]});
 assert.equal('allergies' in EMPTY_HEALTH_DRAFT,false);
});
test('condition and injury drafts can be added, edited by removal and never mutate input',()=>{
 const first=addHealthFact(EMPTY_HEALTH_DRAFT,'conditions','  Type   1 diabetes  ','a');
 const second=addHealthFact(first,'limitations','Ankle stiffness','b');
 assert.deepEqual(second.conditions,[{id:'a',text:'Type 1 diabetes'}]);
 assert.deepEqual(second.limitations,[{id:'b',text:'Ankle stiffness'}]);
 assert.deepEqual(removeHealthFact(second,'conditions','a').conditions,[]);
 assert.deepEqual(EMPTY_HEALTH_DRAFT,{conditions:[],limitations:[]});
});
test('rejects blank, duplicate and too-long IDs; truncates long notes',()=>{
 assert.throws(()=>addHealthFact(EMPTY_HEALTH_DRAFT,'conditions','   ','a'),/Enter/);
 const a=addHealthFact(EMPTY_HEALTH_DRAFT,'conditions','Asthma','id1');
 assert.throws(()=>addHealthFact(a,'conditions','asthma','id2'),/Already added/);
 assert.throws(()=>addHealthFact(a,'limitations','ankle','id1'),/Duplicate entry/);
 assert.throws(()=>addHealthFact(EMPTY_HEALTH_DRAFT,'conditions','a','x'.repeat(101)),/Invalid entry/);
 assert.equal(normalizeHealthFact('x'.repeat(400)).length,MAX_FACT_LENGTH);
});

test('private health RPC contracts roundtrip strings without granting Coach access',()=>{
 const stored=parseSavedHealthConsiderations({
  conditions:['Asthma','Type 1 diabetes'],limitations:['Previous knee injury'],
  coach_opt_in:false,version:3,
 });
 assert.equal(stored.coachOptIn,false);
 assert.equal(stored.version,3);
 assert.deepEqual(healthConsiderationsPayload(stored.draft),{
  conditions:['Asthma','Type 1 diabetes'],limitations:['Previous knee injury'],
 });
 assert.equal(parseSavedHealthConsiderations({coach_opt_in:true}).coachOptIn,true);
 assert.equal(parseSavedHealthConsiderations(null).coachOptIn,false);
 assert.equal(parseSavedHealthConsiderations(null).version,0);
});
test('deleting all health entries produces empty arrays for explicit removal on save',()=>{
 let draft=parseSavedHealthConsiderations({conditions:['Asthma'],limitations:['Knee']}).draft;
 draft=removeHealthFact(draft,'conditions','condition-0');
 draft=removeHealthFact(draft,'limitations','limitation-0');
 assert.deepEqual(healthConsiderationsPayload(draft),{conditions:[],limitations:[]});
});
