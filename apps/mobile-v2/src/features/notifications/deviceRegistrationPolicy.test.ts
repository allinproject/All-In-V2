import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePushRegistration,
  mustClearDeviceAssociation,
  type DeviceRegistrationRequest,
} from './deviceRegistrationPolicy.ts';

const candidate: DeviceRegistrationRequest = {
  expectedOwnerId: 'owner-a',
  authenticatedOwnerId: 'owner-a',
  installationId: 'local_installation_123',
  expoPushToken: 'ExpoPushToken[1234567890abcdef]',
  environment: 'development',
  platform: 'android',
  appProjectId: 'v2-project',
  expectedAppProjectId: 'v2-project',
  permission: 'granted',
};

test('correct owner, project, installation and permission permit registration', () => {
  assert.deepEqual(validatePushRegistration(candidate), { allowed: true });
});

test('signed out and account switch cannot reuse prior owner token', () => {
  assert.equal(validatePushRegistration({ ...candidate, authenticatedOwnerId: null }).allowed, false);
  assert.deepEqual(validatePushRegistration({ ...candidate, authenticatedOwnerId: 'owner-b' }), {
    allowed: false, reason: 'wrong_owner',
  });
  assert.equal(mustClearDeviceAssociation('owner-a', 'owner-b'), true);
  assert.equal(mustClearDeviceAssociation('owner-a', null), true);
  assert.equal(mustClearDeviceAssociation('owner-a', 'owner-a'), false);
});

test('wrong app, revoked permission, missing installation and invalid token fail closed', () => {
  assert.equal(validatePushRegistration({ ...candidate, appProjectId: 'v1-project' }).allowed, false);
  assert.equal(validatePushRegistration({ ...candidate, permission: 'denied' }).allowed, false);
  assert.equal(validatePushRegistration({ ...candidate, installationId: '' }).allowed, false);
  assert.equal(validatePushRegistration({ ...candidate, expoPushToken: 'invalid' }).allowed, false);
});
