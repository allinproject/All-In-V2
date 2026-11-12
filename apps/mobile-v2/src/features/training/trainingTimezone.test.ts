import test from 'node:test';
import assert from 'node:assert/strict';
import {validTrainingTimezone,deviceTrainingTimezone,savedTrainingTimezone,
 trainingTimezonePatch} from './trainingTimezone.ts';
test('IANA athlete zones validate without accepting arbitrary untrusted text',()=>{
 assert.equal(validTrainingTimezone('America/Chicago'),true);
 assert.equal(validTrainingTimezone('Europe/Berlin'),true);
 for(const invalid of ['',null,'Not/A_Real_City','America/Chicago;DROP TABLE x',
  '../../../../home','x'.repeat(101)]){
  assert.equal(validTrainingTimezone(invalid),false);
 }
});
test('profile timezone patch is explicit and does not rewrite other Training keys',()=>{
 assert.deepEqual(trainingTimezonePatch('America/Chicago'),{timezone:'America/Chicago'});
 assert.equal(trainingTimezonePatch('Bogus/City'),null);
 assert.equal(savedTrainingTimezone({timezone:'America/Chicago',current_sports:['running']}),'America/Chicago');
 assert.equal(savedTrainingTimezone({current_sports:['running']}),null);
 assert.equal(savedTrainingTimezone({timezone:'bad'}),null);
});
test('device zone is usable only if Intl resolves a valid value',()=>{
 const zone=deviceTrainingTimezone();
 assert.ok(zone===null||validTrainingTimezone(zone));
});
