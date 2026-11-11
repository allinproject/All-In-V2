import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEventHubInputUrl,prepareEventHubUrlIntent,
 certifyEventHubUrlResolution} from './eventHubUrlIntent.ts';

test('the athlete submits an exact HTTPS organizer URL, never an event directory search',()=>{
 const u=normalizeEventHubInputUrl('https://RACES.example.org/events/42?distance=50K&utm_source=app&fbclid=abc#section');
 assert.equal(u,'https://races.example.org/events/42?distance=50K');
 assert.notEqual(normalizeEventHubInputUrl('https://races.example.org/events/42?distance=50K'),
  normalizeEventHubInputUrl('https://races.example.org/events/42?distance=100M'));
});
test('unsafe or ambiguous local/non-HTTPS URLs are rejected at input boundary',()=>{
 for(const u of ['http://races.example.org/event','javascript:alert(1)',
  'https://localhost/event','https://127.0.0.1/event','https://192.168.1.1',
  'https://169.254.12.1','https://example.internal/event',
  'https://user:pass@example.org','https://[::1]/event','not-a-url']){
  assert.throws(()=>normalizeEventHubInputUrl(u),/event website|public HTTPS/);
 }
});
test('unknown event identity and user accounts cannot become valid match receipts',()=>{
 const intent=prepareEventHubUrlIntent('athlete-1','join-attempt-1','https://race.example.org/meet?id=abc');
 const matched={actorId:'athlete-1',actionId:'join-attempt-1',
  submittedUrl:'https://race.example.org/meet?id=abc',status:'matched' as const,
  eventId:'event-1',groupId:'group-1',verifiedIdentity:true,joined:false};
 assert.equal(certifyEventHubUrlResolution(intent,matched).eventId,'event-1');
 for(const invalid of [{actorId:'athlete-2'},{actionId:'other'},
  {eventId:null},{groupId:null},{verifiedIdentity:false},{joined:true}]){
  assert.throws(()=>certifyEventHubUrlResolution(intent,{...matched,...invalid}),
   /Unverified|exact owner-certified/);
 }
});
test('unresolved website needs evidence rather than inventing event or membership',()=>{
 const intent=prepareEventHubUrlIntent('athlete-1','request-1','https://race.example.org');
 const unresolved={actorId:'athlete-1',actionId:'request-1',
  submittedUrl:'https://race.example.org',status:'needs_evidence' as const,
  eventId:null,groupId:null,verifiedIdentity:false,joined:false};
 assert.equal(certifyEventHubUrlResolution(intent,unresolved).status,'needs_evidence');
 assert.throws(()=>certifyEventHubUrlResolution(intent,{...unresolved,groupId:'made-up'}),/Unresolved/);
});
