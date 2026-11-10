import assert from 'node:assert/strict';
import test from 'node:test';
import { certifyCalendarOwnerRead } from './calendarOwnerReadCertification.ts';
import { combineCalendarReads, type PlannedCalendarItem, type CompletedCalendarItem } from './trainingCalendarReadModel.ts';

const request = {
  expectedOwnerId: 'athlete-a',
  authenticatedOwnerId: 'athlete-a',
  accessGateReady: true,
  requestedFromDate: '2026-10-26',
  requestedThroughDate: '2026-12-06',
};
const snapshot = {
  ownerId: 'athlete-a',
  fromDate: '2026-10-26',
  throughDate: '2026-12-06',
  snapshotVersion: 'accepted-plan-revision-2',
  complete: true,
  nextCursor: null,
  records: [] as readonly PlannedCalendarItem[],
};

test('complete, owner-verified snapshot certifies a truly empty visible month', () => {
  assert.deepEqual(certifyCalendarOwnerRead({...request, snapshot}), {
    status: 'ready',
    ownerId: 'athlete-a',
    fromDate: snapshot.fromDate,
    throughDate: snapshot.throughDate,
    records: [],
  });
});

test('incomplete or paginated fetch cannot claim an empty month', () => {
  for (const candidate of [
    {...snapshot, complete: false},
    {...snapshot, nextCursor: 'page-2'},
    {...snapshot, snapshotVersion: ''},
    {...snapshot, snapshotVersion: '   '},
    {...snapshot, fromDate: '2026-11-01'},
    {...snapshot, throughDate: '2026-11-30'},
    {...snapshot, ownerId: 'athlete-b'},
    {...snapshot, records: null as never},
    {...snapshot, fromDate: 'invalid'},
  ]) {
    assert.equal(certifyCalendarOwnerRead({...request, snapshot: candidate}).status, 'unavailable');
  }
});

test('session switch, signed out, access gate, and invalid requested range fail closed', () => {
  for (const changed of [
    {authenticatedOwnerId: 'athlete-b'},
    {authenticatedOwnerId: null},
    {accessGateReady: false},
    {expectedOwnerId: ''},
    {requestedFromDate: '2026-12-10'},
    {requestedThroughDate: '2026-11-01'},
    {requestedFromDate: '2026-02-30'},
  ]) {
    assert.equal(certifyCalendarOwnerRead({...request, ...changed, snapshot}).status, 'unavailable');
  }
});

test('calendar stays unknown if one independent canonical source is not certified', () => {
  const planned = certifyCalendarOwnerRead({...request, snapshot});
  const completed = certifyCalendarOwnerRead({...request, snapshot: {...snapshot, records: [] as readonly CompletedCalendarItem[], complete: false}});
  const combined = combineCalendarReads({
    ownerId: 'athlete-a',
    fromDate: request.requestedFromDate,
    throughDate: request.requestedThroughDate,
    planned,
    completed,
  });
  assert.equal(combined.status, 'partial');
  assert.equal(combined.markers.status, 'unavailable');
});

test('certification does not silently trust an unverified source during account switch', () => {
  const result = certifyCalendarOwnerRead({
    ...request, authenticatedOwnerId: 'athlete-b', snapshot: {...snapshot, records: [
      {id:'workout-a',ownerId:'athlete-a',athleteLocalDate:'2026-11-10'},
    ]},
  });
  assert.deepEqual(result, {status:'unavailable'});
});
