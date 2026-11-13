import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEventPlanOwnerSnapshot,type EventPlanOwnerSnapshot,type EventPlanOwnerRow} from './eventPlanOwnerPresentation.ts';

const event=(id:string,date:string,priority:'A'|'B'|'C'|'null'='A'):EventPlanOwnerRow=>({
  ownerId:'owner-1',eventId:id,editionId:id+'-2027',eventVersion:1,
  discipline:'endurance',name:id,eventDate:date,
  priority:priority==='null'?null:priority,cancelled:false,
});
const rows=[event('late','2027-09-01'),event('early','2027-04-01'),event('tuneup','2027-05-01','B')];
const snap=(events:readonly EventPlanOwnerRow[]=rows):EventPlanOwnerSnapshot=>({
  ownerId:'owner-1',authSessionGeneration:4,complete:true,nextCursor:null,
  snapshotVersion:'snapshot-1',events,
});
const input=(snapshot:EventPlanOwnerSnapshot|null=snap())=>({
  expectedOwnerId:'owner-1',authenticatedOwnerId:'owner-1',
  sessionGeneration:4,accessGateReady:true,snapshot,today:'2027-01-01',
});
test('keeps multiple primary future events and sorts by date',()=>{
  const result=projectEventPlanOwnerSnapshot(input());
  assert.equal(result.status,'ready');
  if(result.status==='ready'){
    assert.deepEqual(result.events.map(x=>x.eventId),['early','tuneup','late']);
    assert.equal(result.events.filter(x=>x.priority==='A').length,2);
  }
});
test('incomplete or unauthenticated snapshots never represent empty events',()=>{
  for(const changed of [
    {...input(),snapshot:null},
    {...input(),authenticatedOwnerId:'another-owner'},
    {...input(),sessionGeneration:5},
    {...input(),accessGateReady:false},
    {...input(),snapshot:{...snap(),complete:false}},
    {...input(),snapshot:{...snap(),nextCursor:'next-page'}},
    {...input(),snapshot:{...snap(),ownerId:'another-owner'}},
  ]) assert.equal(projectEventPlanOwnerSnapshot(changed).status,'unavailable');
});
test('duplicates, cross-owner events and bad editions fail closed',()=>{
  for(const events of [
    [event('same','2027-04-01'),event('same','2027-05-01')],
    [{...event('foreign','2027-04-01'),ownerId:'owner-2'}],
    [{...event('bad','2027-04-01'),editionId:''}],
    [{...event('bad','2027-04-01'),eventVersion:0}],
  ]) assert.equal(projectEventPlanOwnerSnapshot(input(snap(events))).status,'unavailable');
});
test('past and cancelled events cannot be mistaken for upcoming; cancellation flags require explicit lifecycle handling',()=>{
  const filtered=projectEventPlanOwnerSnapshot(input(snap([event('past','2026-01-01'),event('future','2027-08-01')])));
  assert.equal(filtered.status,'ready');
  if(filtered.status==='ready') assert.deepEqual(filtered.events.map(x=>x.eventId),['future']);
  assert.equal(projectEventPlanOwnerSnapshot(input(snap([{...event('cancelled','2027-09-01'),cancelled:true}]))).status,'unavailable');
});
test('a genuinely complete certified empty snapshot is distinct from unavailable',()=>{
  const result=projectEventPlanOwnerSnapshot(input(snap([])));
  assert.equal(result.status,'ready');
  if(result.status==='ready')assert.deepEqual(result.events,[]);
});
