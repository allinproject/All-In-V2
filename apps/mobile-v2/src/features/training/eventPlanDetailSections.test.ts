import test from 'node:test';
import assert from 'node:assert/strict';
import {eventPlanSections,certifyEventPlanDetailIdentity,type EventPlanDetailIdentity} from './eventPlanDetailSections.ts';
const event:EventPlanDetailIdentity={ownerId:'athlete-a',eventId:'event-1',editionId:'2027-edition',eventVersion:2,discipline:'endurance',name:'Trail Event',eventDate:'2027-06-01'};
const context={ownerId:event.ownerId,eventId:event.eventId,editionId:event.editionId,eventVersion:event.eventVersion};
test('endurance event gets course/fueling but no training preparation accordion',()=>{
 const ids=eventPlanSections('endurance').map(s=>s.id);
 assert.deepEqual(ids,['overview','strategy','course','fueling','logistics','execution']);
 assert.ok(!ids.includes('training' as never));
});
test('sport-specific detail does not assume every event has aid stations',()=>{
 for(const sport of ['swimming','powerlifting','physique','other'] as const) {
  const ids=eventPlanSections(sport).map(s=>s.id);
  assert.ok(!ids.includes('course'));
  assert.ok(!ids.includes('fueling'));
  assert.ok(ids.includes('logistics'));
 }
 assert.ok(eventPlanSections('triathlon').some(s=>s.id==='course'));
});
test('event detail rejects cross-athlete, cross-event, stale edition and revision',()=>{
 assert.equal(certifyEventPlanDetailIdentity(event,context)?.eventId,'event-1');
 for(const changes of [{ownerId:'athlete-b'},{eventId:'event-2'},{editionId:'2028-edition'},{eventVersion:3}])
  assert.equal(certifyEventPlanDetailIdentity(event,{...context,...changes}),null);
 assert.equal(certifyEventPlanDetailIdentity({...event,eventDate:'2027-02-30'},context),null);
});
