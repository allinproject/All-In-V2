import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAcceptedTrainingPlans } from './trainingPlanOwnerProjection.ts';

const row = {
  ownerId: 'athlete-a', revisionId: 'rev-1', title: 'Base training',
  goal: 'General fitness', phase: 'Base', dateRange: 'November–December',
  weekStructure: [{ id: 'session-1', day: 'Monday', sport: 'Strength', purpose: 'Build strength' }],
};
const ready = () => ({ status: 'ready' as const, ownerId: 'athlete-a',
  sessionGeneration: 4, complete: true as const, plans: [row] });
test('accepted source is displayed for exact owner and session', () => {
  const result = projectAcceptedTrainingPlans('athlete-a', 4, ready());
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.plans[0]?.revisionId, 'rev-1');
});
test('unknown source is not falsely interpreted as no plan', () => {
  assert.deepEqual(projectAcceptedTrainingPlans('athlete-a', 4, { status: 'unavailable' }), { status: 'unavailable' });
});
test('wrong account and prior session fail closed', () => {
  assert.equal(projectAcceptedTrainingPlans('athlete-b', 4, ready()).status, 'unavailable');
  assert.equal(projectAcceptedTrainingPlans('athlete-a', 5, ready()).status, 'unavailable');
});
test('cross-owner rows and duplicate revisions fail closed', () => {
  assert.equal(projectAcceptedTrainingPlans('athlete-a', 4, { ...ready(), plans: [{ ...row, ownerId: 'athlete-b' }] }).status, 'unavailable');
  assert.equal(projectAcceptedTrainingPlans('athlete-a', 4, { ...ready(), plans: [row, row] }).status, 'unavailable');
});
test('invalid and duplicate session identities fail closed', () => {
  assert.equal(projectAcceptedTrainingPlans('athlete-a', 4, { ...ready(), plans: [{ ...row, weekStructure: [row.weekStructure[0], row.weekStructure[0]] }] }).status, 'unavailable');
});
test('only a certified empty owner snapshot means no active plan', () => {
  assert.deepEqual(projectAcceptedTrainingPlans('athlete-a', 4, { ...ready(), plans: [] }), { status: 'ready', plans: [] });
});
