import test from 'node:test';
import assert from 'node:assert/strict';
import {certifySeasonAgainstGoalEventOwners} from './canonicalEventGoalApprovalGate.ts';
import {previewGoalEventCertifiedSeasonPhases} from './multiEventPhaseOwnerPreview.ts';
import type {CanonicalEventGoalApproval} from './canonicalEventGoalApprovalGate.ts';
import type {SeasonEvent} from './multiEventSeasonPlan.ts';
const owner='athlete',generation=4,revision='rev-1',token='snapshot-1';
const events:SeasonEvent[]=[
 {id:'event-a',date:'2027-04-10',name:'Trail run',sport:'running',priority:'A',demand:'endurance'},
 {id:'event-b',date:'2027-06-12',name:'Cycling event',sport:'cycling',priority:'B',demand:'endurance'}
];
function dates(){
 const out:string[]=[];
 for(let t=Date.parse('2027-04-01T12:00:00Z');t<=Date.parse('2027-06-12T12:00:00Z');t+=86400000)
  out.push(new Date(t).toISOString().slice(0,10));
 return out;
}
function fixture(){
 const input={
  expectedOwnerId:owner,authenticatedOwnerId:owner,activeSessionGeneration:generation,
  accessGateReady:true,activePlanRevisionId:revision,startDate:'2027-04-01',events,
  plannedSnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:'2027-04-01',
    throughDate:'2027-06-12',snapshotVersion:token,complete:true,nextCursor:null as string|null,
    records:events.map((e,i)=>({id:'session-'+i,ownerId:owner,planRevisionId:revision,
      athleteLocalDate:e.date,sport:e.sport,state:'planned' as const}))},
  daySnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:'2027-04-01',
    throughDate:'2027-06-12',snapshotVersion:token,complete:true,nextCursor:null as string|null,
    records:dates().map((day,i)=>({id:'day-'+i,ownerId:owner,planRevisionId:revision,
       athleteLocalDate:day,dayState:events.some(e=>e.date===day)?'race' as const:'rest' as const}))},
  competitionSnapshot:{ownerId:owner,authSessionGeneration:generation,fromDate:'2027-04-01',
    throughDate:'2027-06-12',snapshotVersion:token,complete:true,nextCursor:null as string|null,
    records:events.map((e,i)=>({eventId:e.id,sessionId:'session-'+i,planRevisionId:revision,
      ownerId:owner,athleteLocalDate:e.date,sport:e.sport,priority:e.priority,
      competitionConfirmed:true as const}))}
 };
 const proofs:CanonicalEventGoalApproval={
  bindingSnapshot:{ownerId:owner,authSessionGeneration:generation,complete:true,
   nextCursor:null,snapshotVersion:token,bindings:events.map((e,i)=>({
    eventId:e.id,eventVersion:2,eventTimezone:'America/Chicago',
    planRevisionId:revision,sessionId:'session-'+i}))},
  eventSnapshot:{ownerId:owner,authSessionGeneration:generation,complete:true,nextCursor:null,
    snapshotVersion:token,events:events.map(e=>({eventId:e.id,ownerId:owner,eventVersion:2,
     date:e.date,timezone:'America/Chicago',sport:e.sport,
     verification:'organizer_verified',participation:'athlete_confirmed',
     evidenceGeneration:generation}))},
  goalSnapshot:{ownerId:owner,authSessionGeneration:generation,complete:true,nextCursor:null,
    snapshotVersion:token,goals:events.map(e=>({goalId:'goal-'+e.id,ownerId:owner,
     goalRevisionId:'goal-rev-'+e.id,goalVersion:3,goalKind:'race_event' as const,status:'accepted',
     targetEventId:e.id,startDate:null,targetDate:e.date}))}
 };
 return {input,proofs};
}
test('two different sports and two events are retained for review only',()=>{
 const {input,proofs}=fixture();const result=certifySeasonAgainstGoalEventOwners(input,proofs);
 assert.equal(result.status,'review_required');if(result.status==='unavailable')throw Error(result.reason);
 assert.deepEqual(result.proposal.events.map(e=>e.id),events.map(e=>e.id));
 assert.equal(result.proposal.invariants.noAutomaticWrite,true);
});
test('missing certification and EventHub group membership do not become race evidence',()=>{
 const {input,proofs}=fixture();
 assert.equal(certifySeasonAgainstGoalEventOwners(input,null).status,'unavailable');
 proofs.eventSnapshot.events=[{...proofs.eventSnapshot.events[0],participation:'group_member'},
  proofs.eventSnapshot.events[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(input,proofs).status,'unavailable');
});
test('stale event version/date and uncoupled goal are not accepted',()=>{
 const f=fixture();f.proofs.eventSnapshot.events=[{...f.proofs.eventSnapshot.events[0],date:'2027-04-11'},
  f.proofs.eventSnapshot.events[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(f.input,f.proofs).status,'unavailable');
 const g=fixture();g.proofs.goalSnapshot.goals=[{...g.proofs.goalSnapshot.goals[0],targetEventId:null},
  g.proofs.goalSnapshot.goals[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(g.input,g.proofs).status,'unavailable');
});
test('changed Event owner version or timezone invalidates accepted Training binding',()=>{
 const a=fixture();
 a.proofs.eventSnapshot.events=[{...a.proofs.eventSnapshot.events[0],eventVersion:3},
  a.proofs.eventSnapshot.events[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(a.input,a.proofs).status,'unavailable');
 const b=fixture();
 b.proofs.bindingSnapshot.bindings=[{...b.proofs.bindingSnapshot.bindings[0],
   eventTimezone:'America/New_York'},b.proofs.bindingSnapshot.bindings[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(b.input,b.proofs).status,'unavailable');
 const c=fixture();
 c.proofs.bindingSnapshot.bindings=[{...c.proofs.bindingSnapshot.bindings[0],
   sessionId:'different'},c.proofs.bindingSnapshot.bindings[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(c.input,c.proofs).status,'unavailable');
});
test('cross-account, cursor, snapshot version and session generation fail closed',()=>{
 const cases=[
  (f:ReturnType<typeof fixture>)=>{f.proofs.goalSnapshot.ownerId='other';},
  (f:ReturnType<typeof fixture>)=>{f.proofs.eventSnapshot.nextCursor='next';},
  (f:ReturnType<typeof fixture>)=>{f.input.daySnapshot.snapshotVersion='old';},
  (f:ReturnType<typeof fixture>)=>{f.proofs.eventSnapshot.authSessionGeneration=5;},
  (f:ReturnType<typeof fixture>)=>{f.input.authenticatedOwnerId='other';},
 ];
 for(const change of cases){const f=fixture();change(f);
  assert.equal(certifySeasonAgainstGoalEventOwners(f.input,f.proofs).status,'unavailable');}
});
test('fake event and Training timezone identifiers fail closed',()=>{
 const a=fixture();
 a.proofs.eventSnapshot.events=[{...a.proofs.eventSnapshot.events[0],timezone:'Mars/Phobos'},
  a.proofs.eventSnapshot.events[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(a.input,a.proofs).status,'unavailable');
 const b=fixture();
 b.proofs.bindingSnapshot.bindings=[{...b.proofs.bindingSnapshot.bindings[0],
   eventTimezone:'Mars/Phobos'},b.proofs.bindingSnapshot.bindings[1]];
 assert.equal(certifySeasonAgainstGoalEventOwners(b.input,b.proofs).status,'unavailable');
});
test('different valid version tokens from separate Goal, Event and Training owners are allowed',()=>{
 const f=fixture();
 f.proofs.goalSnapshot.snapshotVersion='goals-revision-12';
 f.proofs.eventSnapshot.snapshotVersion='event-revision-20';
 f.proofs.bindingSnapshot.snapshotVersion='training-binding-revision-8';
 assert.equal(certifySeasonAgainstGoalEventOwners(f.input,f.proofs).status,'review_required');
});
test('undated qualitative goal can coexist without manufacturing an event',()=>{
 const f=fixture();f.proofs.goalSnapshot.goals=[...f.proofs.goalSnapshot.goals,{
  goalId:'qualitative',ownerId:owner,goalRevisionId:'q-rev',goalVersion:1,
  goalKind:'other',
  status:'accepted',targetEventId:null,startDate:null,targetDate:null
 }];
 assert.equal(certifySeasonAgainstGoalEventOwners(f.input,f.proofs).status,'review_required');
});

test('non-race goal cannot authorize a race, but independent qualitative goals remain valid',()=>{
 const wrong=fixture();
 wrong.proofs.goalSnapshot.goals[0]={...wrong.proofs.goalSnapshot.goals[0],goalKind:'other'};
 assert.equal(certifySeasonAgainstGoalEventOwners(wrong.input,wrong.proofs).status,'unavailable');
 const valid=fixture();
 valid.proofs.goalSnapshot.goals.push({
  goalId:'nutrition',ownerId:owner,goalRevisionId:'nutrition-rev',goalVersion:1,
  goalKind:'other',status:'accepted',targetEventId:null,startDate:null,targetDate:null
 });
 assert.equal(certifySeasonAgainstGoalEventOwners(valid.input,valid.proofs).status,'review_required');
});
test('stale goal target dates or start dates cannot override an event',()=>{
 const stale=fixture();
 stale.proofs.goalSnapshot.goals[0]={...stale.proofs.goalSnapshot.goals[0],targetDate:'2027-04-11'};
 assert.equal(certifySeasonAgainstGoalEventOwners(stale.input,stale.proofs).status,'unavailable');
 const later=fixture();
 later.proofs.goalSnapshot.goals[0]={...later.proofs.goalSnapshot.goals[0],startDate:'2027-05-01'};
 assert.equal(certifySeasonAgainstGoalEventOwners(later.input,later.proofs).status,'unavailable');
 const valid=fixture();
 valid.proofs.goalSnapshot.goals[0]={...valid.proofs.goalSnapshot.goals[0],startDate:'2027-02-01'};
 assert.equal(certifySeasonAgainstGoalEventOwners(valid.input,valid.proofs).status,'review_required');
});

test('Coach season phase preview needs both canonical Goal/Event and Training authority',()=>{
 const f=fixture();
 const phaseDecisions=[
  {eventId:'event-a',effort:'supported' as const,taperDays:3,recoveryReviewDays:4,source:'athlete_confirmed' as const,evidenceRefs:[]},
  {eventId:'event-b',effort:'peak' as const,taperDays:null,recoveryReviewDays:null,source:'athlete_confirmed' as const,evidenceRefs:[]}
 ];
 const valid=previewGoalEventCertifiedSeasonPhases({ownerSeason:f.input,goalEventOwners:f.proofs,
  expectedPlanRevisionId:revision,phaseDecisions});
 assert.equal(valid.status,'review_required');
 if(valid.status==='unavailable')throw Error(valid.reason);
 assert.equal(valid.canWriteAcceptedPlan,false);
 assert.deepEqual(valid.draft.events.map(e=>e.id),['event-a','event-b']);
 const missing=previewGoalEventCertifiedSeasonPhases({ownerSeason:f.input,goalEventOwners:null,
  expectedPlanRevisionId:revision,phaseDecisions});
 assert.equal(missing.status,'unavailable');
 const stale=previewGoalEventCertifiedSeasonPhases({ownerSeason:f.input,goalEventOwners:f.proofs,
  expectedPlanRevisionId:'stale',phaseDecisions});
 assert.equal(stale.status,'unavailable');
});
test('Coach phase preview cannot use stale Goal/Event certification or non-race goals',()=>{
 const f=fixture();
 const phaseDecisions=[
  {eventId:'event-a',effort:'supported' as const,taperDays:2,recoveryReviewDays:3,source:'athlete_confirmed' as const,evidenceRefs:[]},
  {eventId:'event-b',effort:'supported' as const,taperDays:2,recoveryReviewDays:3,source:'athlete_confirmed' as const,evidenceRefs:[]}
 ];
 f.proofs.goalSnapshot.goals[0]={...f.proofs.goalSnapshot.goals[0],goalKind:'other'};
 assert.equal(previewGoalEventCertifiedSeasonPhases({ownerSeason:f.input,goalEventOwners:f.proofs,
  expectedPlanRevisionId:revision,phaseDecisions}).status,'unavailable');
 const g=fixture();g.proofs.eventSnapshot.events[0]={...g.proofs.eventSnapshot.events[0],eventVersion:99};
 assert.equal(previewGoalEventCertifiedSeasonPhases({ownerSeason:g.input,goalEventOwners:g.proofs,
  expectedPlanRevisionId:revision,phaseDecisions}).status,'unavailable');
});
