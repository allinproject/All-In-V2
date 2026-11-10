/**
 * ALL-237: account-isolated push token registration preflight.
 *
 * Pure validation only: server MUST additionally bind expectedOwnerId to
 * auth.uid() before any read/write, atomically revoke superseded registrations
 * and dedupe the canonical installation identifier.
 */
export type DeviceRegistrationRequest = {
  expectedOwnerId: string;
  authenticatedOwnerId: string | null;
  installationId: string;
  expoPushToken: string;
  environment: 'development' | 'preview' | 'production';
  platform: 'ios' | 'android';
  appProjectId: string;
  expectedAppProjectId: string;
  permission: 'granted' | 'denied' | 'undetermined';
};
export type DeviceRegistrationDecision =
  | { allowed: true }
  | { allowed: false; reason: 'signed_out' | 'wrong_owner' | 'missing_installation' | 'wrong_project' | 'permission_denied' | 'invalid_token' };

export function validatePushRegistration(req: DeviceRegistrationRequest): DeviceRegistrationDecision {
  if (!req.authenticatedOwnerId) return { allowed: false, reason: 'signed_out' };
  if (!req.expectedOwnerId || req.expectedOwnerId !== req.authenticatedOwnerId) {
    return { allowed: false, reason: 'wrong_owner' };
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(req.installationId)) {
    return { allowed: false, reason: 'missing_installation' };
  }
  if (!req.appProjectId || !req.expectedAppProjectId || req.appProjectId !== req.expectedAppProjectId) {
    return { allowed: false, reason: 'wrong_project' };
  }
  if (req.permission !== 'granted') return { allowed: false, reason: 'permission_denied' };
  if (!/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,256}\]$/.test(req.expoPushToken)) {
    return { allowed: false, reason: 'invalid_token' };
  }
  return { allowed: true };
}

/**
 * On sign-out/switch, the app must clear its in-memory token association.
 * This is a local instruction, not server-side proof of revocation.
 */
export function mustClearDeviceAssociation(
  registeredOwnerId: string | null,
  nextOwnerId: string | null,
): boolean {
  return registeredOwnerId !== null && registeredOwnerId !== nextOwnerId;
}
