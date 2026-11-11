import test from 'node:test';
import assert from 'node:assert/strict';
import {eventHubWorkoutProjection,
 type EventHubCandidate,type EventHubShareEvidence,type EventHubCandidateBatch,
} from './eventHubShareEligibility.ts';

const evidence=():EventHubShareEvidence=>({
 athleteId:'athlete-1',canonicalPostId:'community-post-1',
 canonicalWorkoutId:'workout-1',postedAfterExplicitApproval:true,
 postAudience:'public',publishedAt:'2026-11-10T15:00:00Z',
 workoutSportKind:'running',explicitlyLinkedGroupId:null,
 optedOutGroupIds:[],confirmedEventDayWorkout:false,
});
const group=(x:Partial<EventHubCandidate>={}):EventHubCandidate=>({
 athleteId:'athlete-1',eventId:'event-1',groupId:'group-1',
 joinedAt:'2026-11-01T12:00:00Z',eventLocalDay:'2026-11-20',
 eventTimezone:'America/Chicago',publishedEventLocalDay:'2026-11-10',
 workoutEventLocalDay:'2026-11-10',acceptedSportKinds:['running','walking'],
 ...x,
});
const batch=(items:EventHubCandidate[]):EventHubCandidateBatch=>({
 athleteId:'athlete-1',complete:true,nextCursor:null,candidates:items,
});
test('one explicitly approved workout post projects once into one joined event',()=>{
 assert.deepEqual(eventHubWorkoutProjection(evidence(),batch([group()])),{
 status:'eligible',groupId:'group-1',
 reason:'One existing explicitly approved Community workout post may be projected.',
 });
});
test('imports and private content do not auto-publish',()=>{
 assert.equal(eventHubWorkoutProjection({...evidence(),postedAfterExplicitApproval:false},batch([group()])).status,'not_eligible');
 assert.equal(eventHubWorkoutProjection({...evidence(),postAudience:'private'},batch([group()])).status,'not_eligible');
});
test('before-membership and sport mismatch cannot backfill another group',()=>{
 assert.equal(eventHubWorkoutProjection(evidence(),batch([group({joinedAt:'2026-11-11T15:00:00Z'})])).status,'not_eligible');
 assert.equal(eventHubWorkoutProjection(evidence(),batch([group({acceptedSportKinds:['cycling']})])).status,'not_eligible');
});
test('ended event does not receive later ordinary workout posts',()=>{
 const late=group({eventLocalDay:'2026-11-09',publishedEventLocalDay:'2026-11-10',workoutEventLocalDay:'2026-11-09'});
 assert.equal(eventHubWorkoutProjection(evidence(),batch([late])).status,'not_eligible');
 const allowed=eventHubWorkoutProjection({
  ...evidence(),explicitlyLinkedGroupId:'group-1',confirmedEventDayWorkout:true,
 },batch([late]));
 assert.equal(allowed.status,'eligible');
 assert.equal(eventHubWorkoutProjection(evidence(),batch([group({workoutEventLocalDay:'2026-11-21'})])).status,'not_eligible');
});
test('ambiguous groups require explicit selection and avoid duplicate identity',()=>{
 const two=[group(),group({groupId:'group-2',eventId:'event-2'})];
 assert.equal(eventHubWorkoutProjection(evidence(),batch(two)).status,'review_required');
 assert.equal(eventHubWorkoutProjection({...evidence(),explicitlyLinkedGroupId:'group-2'},batch(two)).groupId,'group-2');
 assert.throws(()=>eventHubWorkoutProjection(evidence(),batch([group(),group()])),/duplicate/);
});
test('user opt-out is durable even after matching or tagging',()=>{
 assert.equal(eventHubWorkoutProjection({...evidence(),optedOutGroupIds:['group-1']},batch([group()])).status,'not_eligible');
});
test('wrong-owner, incomplete, invalid date or cursored candidate set must fail closed',()=>{
 assert.throws(()=>eventHubWorkoutProjection(evidence(),batch([group({athleteId:'other'})])),/Foreign/);
 assert.throws(()=>eventHubWorkoutProjection(evidence(),{...batch([group()]),complete:false}),/Incomplete/);
 assert.throws(()=>eventHubWorkoutProjection(evidence(),{...batch([group()]),nextCursor:'page-2'}),/Incomplete/);
 assert.throws(()=>eventHubWorkoutProjection(evidence(),batch([group({eventLocalDay:'2026-02-30'})])),/Foreign/);
});
test('event-local dates—not UTC date slices—control midnight cutoffs',()=>{
 const midnight=group({
  eventLocalDay:'2026-11-10',
  workoutEventLocalDay:'2026-11-10',
  publishedEventLocalDay:'2026-11-10',
 });
 const post={...evidence(),publishedAt:'2026-11-11T01:00:00Z'};
 assert.equal(eventHubWorkoutProjection(post,batch([midnight])).status,'eligible');
});
