import test from 'node:test';
import assert from 'node:assert/strict';
import { todayWellnessGlance, type TodayWellnessSnapshot } from './todayWellnessGlances.ts';

const day='2026-11-11',ownerId='athlete-one', now=new Date('2026-11-11T18:00:00Z');
const progress:TodayWellnessSnapshot={
  ownerId,athleteLocalDate:day,sourceRevision:'progress-rev-1',
  calculatedAt:'2026-11-11T17:30:00Z',source:'progress',sport:'cycling',
  label:'Cycling progress',summary:'Verified weekly distance: 60 miles.',
};
const recovery:TodayWellnessSnapshot={
  ...progress,source:'recovery',sourceRevision:'recovery-rev-2',sport:null,
  label:'Recovery check-in',summary:'Recovery observations recorded today.',
};
const show=(snapshot:TodayWellnessSnapshot,domain:'progress'|'recovery'='progress')=>
  todayWellnessGlance({status:'ready',snapshot},ownerId,day,domain,now);

test('unconnected domains never invent metrics or recovery advice',()=>{
  assert.equal(todayWellnessGlance({status:'unavailable'},ownerId,day,'progress',now).status,'unavailable');
  assert.match(todayWellnessGlance({status:'loading'},ownerId,day,'recovery',now).detail,/not connected/);
});
test('verified sport-specific progress preserves source text',()=>{
  assert.deepEqual(show(progress),{
    status:'ready',label:'Cycling progress',detail:'Verified weekly distance: 60 miles.',
  });
});
test('verified recovery displays only supplied observations',()=>{
  assert.equal(show(recovery,'recovery').detail,'Recovery observations recorded today.');
});
test('wrong owner, day or domain refuses evidence',()=>{
  assert.equal(todayWellnessGlance({status:'ready',snapshot:progress},'athlete-two',day,'progress',now).status,'unavailable');
  assert.equal(todayWellnessGlance({status:'ready',snapshot:progress},ownerId,'2026-11-10','progress',now).status,'unavailable');
  assert.equal(show(progress,'recovery').status,'unavailable');
});
test('stale, future and malformed timestamps are unavailable',()=>{
  assert.equal(show({...progress,calculatedAt:'2026-11-09T17:00:00Z'}).status,'unavailable');
  assert.equal(show({...progress,calculatedAt:'2026-11-11T21:00:00Z'}).status,'unavailable');
  assert.equal(show({...progress,calculatedAt:'bad'}).status,'unavailable');
});
test('empty or malformed source fields fail closed',()=>{
  assert.equal(show({...progress,sourceRevision:''}).status,'unavailable');
  assert.equal(show({...progress,label:'   '}).status,'unavailable');
  assert.equal(show({...progress,summary:'\nunsafe'}).status,'unavailable');
  assert.equal(show({...progress,sport:'\n'}).status,'unavailable');
});
test('no active owner cannot show cached athlete summaries',()=>{
  assert.equal(todayWellnessGlance({status:'ready',snapshot:progress},'',day,'progress',now).status,'unavailable');
});
