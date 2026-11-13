import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCanonicalEventGoalComposite,
  type CanonicalEventGoalComposite,type CanonicalCompositeEvent,type CanonicalCompositeGoal}
  from './eventPlanCompositeReview.ts';
const event=(id:string,date='2027-05-01'):CanonicalCompositeEvent=>({
  ownerId:'athlete-a',eventId:id,editionId:id+'-edition',eventVersion:2,
  name:'Verified '+id,date,timezone:'America/Chicago',sport:'running',
  verification:'organizer_verified',participation:'interested',
  participationSource:'athlete_confirmed',cancelled:false,
});
const goal=(id:string,eventId:string,role='primary'):CanonicalCompositeGoal=>({
  goalId:id,goalKind:'race_event',goalStatus:'active',
  activeRevisionId:id+'-revision',revisionStatus:'accepted',
  priorityRole:role,eventId,editionId:eventId+'-edition',boundEventVersion:2,
});
const composite=(events:CanonicalCompositeEvent[]=[event('one'),event('two','2027-06-01')],
  goals:CanonicalCompositeGoal[]=[goal('g1','one'),goal('g2','two')]):CanonicalEventGoalComposite=>({
  ownerId:'athlete-a',complete:true,nextCursor:null,
  status:'owner_sources_complete',eventSnapshotVersion:'event-snap',
  goalSnapshotVersion:'goal-snap',events,goals,
  eventRegistrationInferred:false,trainingPlanApproved:false,
});
const ctx=(c:CanonicalEventGoalComposite|null=composite())=>({
  expectedOwnerId:'athlete-a',authenticatedOwnerId:'athlete-a',
  sessionGeneration:2,accessGateReady:true,serverOwnerReadReady:true,composite:c,
});
test('keeps multiple accepted primary goals and does not invent Event A/B/C',()=>{
 const result=reviewCanonicalEventGoalComposite(ctx());
 assert.equal(result.status,'review_ready');
 if(result.status!=='review_ready')return;
 assert.deepEqual(result.events.map(x=>x.event.eventId),['one','two']);
 assert.deepEqual(result.events.map(x=>x.acceptedGoals[0].priorityRole),['primary','primary']);
 assert.deepEqual(result.events.map(x=>x.event.participation),['interested','interested']);
 assert.ok(result.events.every(x=>!('priority' in x.event)));
});
test('wrong owner, access gate or incomplete source is unavailable',()=>{
 for(const changes of [
   {authenticatedOwnerId:'athlete-b'},
   {sessionGeneration:-1},{accessGateReady:false},{serverOwnerReadReady:false},
   {composite:null},{composite:{...composite(),complete:false}},
   {composite:{...composite(),ownerId:'athlete-b'}},
   {composite:{...composite(),nextCursor:'later'}},
 ]) assert.equal(reviewCanonicalEventGoalComposite({...ctx(),...changes} as Parameters<typeof ctx>[0] & ReturnType<typeof ctx>).status,'unavailable');
});
test('stale Goal to Event edition/version and missing participation are review-only',()=>{
 for(const goals of [
   [{...goal('g1','one'),editionId:'another'}],
   [{...goal('g1','one'),boundEventVersion:1}],
   [goal('g1','not-in-event-participations')],
   [{...goal('g1','one'),revisionStatus:'candidate'}],
   [{...goal('g1','one'),priorityRole:'A'}],
   [{...goal('g1','one'),activeRevisionId:null}],
 ]) {
   assert.equal(reviewCanonicalEventGoalComposite(ctx(composite([event('one')],goals))).status,'review_required');
 }
});
test('provisional events cannot become authoritative race instructions',()=>{
 for(const eventChanges of [
   {verification:'athlete_submitted'},{date:null},
   {cancelled:true},{ownerId:'athlete-b'},{eventVersion:0},
   {timezone:''},{participation:'joined'},
 ]) assert.equal(reviewCanonicalEventGoalComposite(ctx(composite([{...event('one'),...eventChanges}],[]))).status,'review_required');
});
test('independent complete but unbound non-race Goals do not fabricate Event bindings',()=>{
 const nonRace:CanonicalCompositeGoal={...goal('habit','one'),goalKind:'nutrition_habit',
   eventId:null,editionId:null,boundEventVersion:null,activeRevisionId:null,
   revisionStatus:null,priorityRole:null};
 const result=reviewCanonicalEventGoalComposite(ctx(composite([event('one')],[nonRace])));
 assert.equal(result.status,'review_ready');
 if(result.status==='review_ready')assert.deepEqual(result.events[0].acceptedGoals,[]);
 assert.equal(reviewCanonicalEventGoalComposite(ctx({...composite(),status:'review_required'})).status,'review_required');
});
