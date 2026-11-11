/** ALL-251: pure request/authorization input guards; no credentials or network access. */
export type DeleteWorkerRequest = { user_id: string; request_id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseDeletionWorkerRequest(value: unknown): DeleteWorkerRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (typeof fields.user_id !== 'string' || typeof fields.request_id !== 'string') return null;
  if (!UUID.test(fields.user_id) || !UUID.test(fields.request_id)) return null;
  if (Object.keys(fields).some(key => key !== 'user_id' && key !== 'request_id')) return null;
  return { user_id: fields.user_id, request_id: fields.request_id };
}
export function isWorkerArmed(value: string | undefined): boolean { return value === 'true'; }
export function isAuthenticatedWorkerToken(candidate: string | null, configured: string | undefined): boolean {
  if (!candidate || !configured || configured.length < 32 || candidate.length !== configured.length) return false;
  // Fixed-time character comparison; never disclose the worker token.
  let mismatch = 0;
  for (let i = 0; i < configured.length; i++) mismatch |= configured.charCodeAt(i) ^ candidate.charCodeAt(i);
  return mismatch === 0;
}
