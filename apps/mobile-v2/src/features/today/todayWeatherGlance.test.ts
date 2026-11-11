import test from 'node:test';
import assert from 'node:assert/strict';
import { todayWeatherGlance, type TodayWeatherSnapshot } from './todayWeatherGlance.ts';

const day='2026-11-11', ownerId='athlete-a', now=new Date('2026-11-11T18:00:00Z');
const snapshot:TodayWeatherSnapshot={ownerId,athleteLocalDate:day,observedAt:'2026-11-11T17:30:00Z',sourceRevision:'weather-rev-1',display:'Cloudy, 48°F',locationConsent:'granted'};
const show=(value:TodayWeatherSnapshot=snapshot, owner=ownerId, selectedDay=day)=>todayWeatherGlance({status:'ready',snapshot:value},owner,selectedDay,now);
test('unavailable and denied source never shows location weather',()=>{
 for(const status of ['unavailable','loading','error','permission_denied'] as const)
  assert.equal(todayWeatherGlance({status},ownerId,day,now).status,'unavailable');
 assert.equal(show({...snapshot,locationConsent:'revoked' as TodayWeatherSnapshot['locationConsent']}).status,'unavailable');
});
test('valid fresh consented owner weather displays source text',()=>{
 assert.deepEqual(show(),{status:'ready',label:'Cloudy, 48°F'});
});
test('wrong owner, date and blank identity fail closed',()=>{
 assert.equal(show(snapshot,'athlete-b').status,'unavailable');
 assert.equal(show(snapshot,ownerId,'2026-11-10').status,'unavailable');
 assert.equal(show(snapshot,'').status,'unavailable');
});
test('stale/future/invalid observation timestamps are unavailable',()=>{
 assert.equal(show({...snapshot,observedAt:'2026-11-11T13:00:00Z'}).status,'unavailable');
 assert.equal(show({...snapshot,observedAt:'2026-11-11T21:00:00Z'}).status,'unavailable');
 assert.equal(show({...snapshot,observedAt:'bad'}).status,'unavailable');
});
test('malformed source and summary cannot appear',()=>{
 assert.equal(show({...snapshot,sourceRevision:''}).status,'unavailable');
 assert.equal(show({...snapshot,display:'  '}).status,'unavailable');
 assert.equal(show({...snapshot,display:'x'.repeat(51)}).status,'unavailable');
 assert.equal(show({...snapshot,display:'\nunsafe'}).status,'unavailable');
});
