// ALL-251 — STAGED ONLY. Do not deploy, arm or schedule before reviewed acceptance.
// Real deletion uses service role exclusively and requires TWO independent default-off
// gates: ALLIN_DELETION_WORKER_ARMED env AND private DB execution_enabled.
// Existing Profile request/cancel flow is the only user-facing initiation path.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { parseDeletionWorkerRequest, isWorkerArmed, isAuthenticatedWorkerToken } from './policy.ts';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
function reply(status: number, code: string) {
  return new Response(JSON.stringify({ status: 'error', code }), { status, headers });
}
function isAbsentUserError(error: { status?: number; code?: string } | null): boolean {
  return !!error && (error.status === 404 || error.code === 'user_not_found');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, 'method_not_allowed');

  // No browser CORS; never expose a service credential to the mobile app.
  const serviceUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  const workerToken = Deno.env.get('ALLIN_DELETION_WORKER_TOKEN');
  if (!isWorkerArmed(Deno.env.get('ALLIN_DELETION_WORKER_ARMED')))
    return reply(503, 'worker_disabled');
  if (!isAuthenticatedWorkerToken(req.headers.get('x-allin-worker-token'), workerToken))
    return reply(403, 'worker_unauthorized');
  if (!serviceUrl || !serviceKey) return reply(503, 'worker_not_configured');

  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > 2048) return reply(413, 'invalid_request');
  let payload: unknown;
  try {
    const body = await req.text();
    if (body.length > 2048) return reply(413, 'invalid_request');
    payload = JSON.parse(body);
  } catch {
    return reply(400, 'invalid_request');
  }
  const request = parseDeletionWorkerRequest(payload);
  if (!request) return reply(400, 'invalid_request');

  const client = createClient(serviceUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const args = {
    p_expected_user_id: request.user_id,
    p_expected_request_id: request.request_id,
  };

  // This function checks the private OFF switch, schema/Storage coverage, exact
  // current request ID, per-owner locks and creates the durable audit record
  // atomically with marking the request processing. Fail closed on any error.
  const { data: claimed, error: claimError } =
    await client.rpc('v2_claim_account_deletion_for_processing', args);
  if (claimError || !claimed || claimed.status !== 'processing' ||
      claimed.user_id !== request.user_id || claimed.request_id !== request.request_id)
    return reply(409, 'claim_not_accepted');

  // The request has been claimed. Never retry this destructive operation
  // automatically after an uncertain network outcome.
  let errorCode: 'auth_delete_failed' | 'auth_verify_failed' | 'completion_failed' | null = null;
  try {
    const result = await client.auth.admin.deleteUser(request.user_id);
    if (result.error) {
      errorCode = 'auth_delete_failed';
    } else {
      const observed = await client.auth.admin.getUserById(request.user_id);
      if (!isAbsentUserError(observed.error)) {
        // A successful call without a confirmed absence is not completion.
        errorCode = 'auth_verify_failed';
      } else {
        // Checks DB Auth disappearance and request cascade, then removes user ID
        // from minimal audit record. Durable request ID remains for proof.
        const { data: final, error: finalError } =
          await client.rpc('v2_record_account_deletion_completion', args);
        if (!finalError && final?.status === 'completed' &&
            final.request_id === request.request_id) {
          return new Response(JSON.stringify({
            status: 'completed', request_id: request.request_id,
          }), { status: 200, headers });
        }
        errorCode = 'completion_failed';
      }
    }
  } catch {
    errorCode = 'auth_delete_failed';
  }

  // Preserve a generic, non-PII failure record for manual recovery; do not claim
  // erasure and do not retry or auto-rearm. If even recording fails, escalate.
  try {
    const { error: recordedError } = await client.rpc('v2_record_account_deletion_failure', {
      ...args, p_failure_code: errorCode ?? 'completion_failed',
    });
    if (recordedError) return reply(500, 'manual_recovery_required');
  } catch {
    return reply(500, 'manual_recovery_required');
  }
  return reply(500, 'manual_recovery_required');
});
