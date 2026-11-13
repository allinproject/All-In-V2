// ALL-251 — STAGED ONLY. Do not deploy, arm or schedule before reviewed acceptance.
// Real deletion uses service role exclusively and requires TWO independent default-off
// gates: ALLIN_DELETION_WORKER_ARMED env AND private DB execution_enabled.
// Existing Profile request/cancel flow is the only user-facing initiation path.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { parseDeletionWorkerRequest, isWorkerArmed, isAuthenticatedWorkerToken } from './policy.ts';
import { executeDeletionOnce } from './execution.ts';
import { createOperationalStorageReadiness } from '../_shared/trainingDeletionOperationalStorageReadiness.mjs';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
function reply(status: number, code: string) {
  return new Response(JSON.stringify({ status: 'error', code }), { status, headers });
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
  const result = await executeDeletionOnce(request, {
    claim: async () => await client.rpc('v2_claim_account_deletion_for_processing', args),
    // Requires an authoritative, request-scoped DB attestation combining
    // actual Storage absence, durable object checkpoints and a real upload
    // freeze. The RPC is intentionally NOT deployed until that contract is
    // accepted; its absence fails closed before irreversible Auth deletion.
    verifyStorageReadiness: createOperationalStorageReadiness({ supabase: client }).verifyStorageReadiness,
    deleteAuthUser: async userId => await client.auth.admin.deleteUser(userId),
    inspectAuthUser: async userId => await client.auth.admin.getUserById(userId),
    complete: async () => await client.rpc('v2_record_account_deletion_completion', args),
    verifyCompletion: async () => await client.rpc('v2_verify_account_deletion_completion', { p_expected_request_id: request.request_id }),
    recordFailure: async (_request, reason) => await client.rpc('v2_record_account_deletion_failure', {
      ...args, p_failure_code: reason,
    }),
  });
  if (result !== 'completed') return reply(result === 'claim_not_accepted' ? 409 :
    result === 'storage_not_accepted' ? 503 : 500, result);
  return new Response(JSON.stringify({ status: 'completed', request_id: request.request_id }), {
    status: 200, headers,
  });
});
