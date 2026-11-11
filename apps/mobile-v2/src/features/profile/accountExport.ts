/** ALL-251: validate a current-schema account snapshot before explicit native file export.
 * No on-device persistence, logging or automatic export.
 */
export const V2_ACCOUNT_EXPORT_VERSION = 'v2-account-export-snapshot-v1';
export const V2_EXPORT_MAX_CHARS = 1000000;

export function prepareV2AccountExport(value: unknown, expectedOwnerId: string): string {
  if (!expectedOwnerId.trim()) throw new Error('Sign in before exporting account data.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Account export returned an invalid snapshot.');
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schema_version !== V2_ACCOUNT_EXPORT_VERSION) {
    throw new Error('This account export version is not supported yet.');
  }
  const account = snapshot.account;
  if (!account || typeof account !== 'object' || Array.isArray(account)
    || (account as Record<string, unknown>).id !== expectedOwnerId) {
    throw new Error('Account export does not match the signed-in owner.');
  }
  const required = [
    'account', 'profile', 'profile_settings', 'onboarding_progress',
    'legal_acceptances', 'health_considerations', 'profile_settings_actions',
    'onboarding_actions', 'deletion_request', 'deletion_execution',
  ];
  if (required.some(key => !(key in snapshot))) {
    throw new Error('Account export is incomplete. Nothing was shared.');
  }
  const json = JSON.stringify(snapshot, null, 2);
  if (!json || json.length > V2_EXPORT_MAX_CHARS) {
    throw new Error('This export is too large for a temporary file. Contact support for a larger export.');
  }
  return json;
}
