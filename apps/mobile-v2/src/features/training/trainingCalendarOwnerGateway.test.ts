import assert from 'node:assert/strict';
import test from 'node:test';
import { readAuthenticatedTrainingCalendar } from './trainingCalendarOwnerGateway.ts';
import type {
  PlannedCalendarItem, CompletedCalendarItem,
  OwnerCalendarRead,
} from './trainingCalendarReadModel.ts';

const planned: PlannedCalendarItem = {
  id: 'planned-1', ownerId: 'athlete-a', athleteLocalDate: '2026-11-14',
  sport: 'running', state: 'planned', planRevisionId: 'revision-1',
};
const completed: CompletedCalendarItem = {
  id: 'completed-1', ownerId: 'athlete-a', athleteLocalDate: '2026-11-14',
  sport: 'strength', source: 'manual_entry', plannedSessionId: null,
};
const plannedRead: OwnerCalendarRead<PlannedCalendarItem> = {
  status: 'ready', ownerId: 'athlete-a', fromDate: '2026-11-10',
  throughDate: '2026-11-16', records: [planned],
};
const completedRead: OwnerCalendarRead<CompletedCalendarItem> = {
  status: 'ready', ownerId: 'athlete-a', fromDate: '2026-11-10',
  throughDate: '2026-11-16', records: [completed],
};
const makeArgs = () => ({
  session: { ownerId: 'athlete-a', generation: 5, isCurrent: () => true },
  fromDate: '2026-11-10', throughDate: '2026-11-16',
  readPlanned: async () => plannedRead,
  readCompleted: async () => completedRead,
});

test('combines only complete owner-scoped scheduled and actual reads', async () => {
  const result = await readAuthenticatedTrainingCalendar(makeArgs());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.markers.status === 'ready' &&
    result.markers.records.map(record => [record.kind, record.status]),
    [['running','planned'], ['strength','completed']]);
});

test('invalid session or date prevents both owner readers from running', async () => {
  for (const mutation of [
    { session: {ownerId: 'athlete-a', generation: 5, isCurrent: () => false} },
    { session: {ownerId: '', generation: 5, isCurrent: () => true} },
    { session: {ownerId: 'athlete-a', generation: -1, isCurrent: () => true} },
    { fromDate: '2026-11-31' },
  ]) {
    let calls = 0;
    const result = await readAuthenticatedTrainingCalendar({
      ...makeArgs(), ...mutation,
      readPlanned: async () => { calls++; return plannedRead; },
      readCompleted: async () => { calls++; return completedRead; },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, 'unavailable');
  }
});

test('session/account switch during pending request invalidates both results', async () => {
  let current = true;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const args = makeArgs();
  const request = readAuthenticatedTrainingCalendar({
    ...args,
    session: {...args.session, isCurrent: () => current },
    readPlanned: async () => { await pending; return plannedRead; },
  });
  await Promise.resolve();
  current = false;
  release();
  const result = await request;
  assert.equal(result.status, 'unavailable');
  assert.equal(result.markers.status, 'unavailable');
});

test('one failed reader stays unavailable rather than becoming a false empty day', async () => {
  const result = await readAuthenticatedTrainingCalendar({
    ...makeArgs(),
    readCompleted: async () => { throw new Error('network error'); },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.planned.status, 'ready');
  assert.equal(result.completed.status, 'unavailable');
  assert.equal(result.markers.status, 'unavailable');
});

test('foreign-owner and truncated owner data cannot produce verified markers', async () => {
  for (const badRead of [
    {...completedRead, ownerId: 'athlete-b'},
    {...completedRead, fromDate: '2026-11-11'},
  ]) {
    const result = await readAuthenticatedTrainingCalendar({
      ...makeArgs(), readCompleted: async () => badRead,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.markers.status, 'unavailable');
  }
});
