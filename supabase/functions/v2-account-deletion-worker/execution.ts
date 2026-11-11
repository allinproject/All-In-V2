/** ALL-251: isolated deletion execution. No network, deployment, or retries here. */
export type WorkerRequest = { user_id: string; request_id: string };
export type RpcResponse = { data?: unknown; error?: unknown };
export type AdminResponse = { error?: { status?: number; code?: string } | null };
export type DeletionServices = {
  claim: (request: WorkerRequest) => Promise<RpcResponse>;
  deleteAuthUser: (userId: string) => Promise<AdminResponse>;
  inspectAuthUser: (userId: string) => Promise<AdminResponse>;
  complete: (request: WorkerRequest) => Promise<RpcResponse>;
  verifyCompletion: (request: WorkerRequest) => Promise<RpcResponse>;
  recordFailure: (request: WorkerRequest, reason: FailureReason) => Promise<RpcResponse>;
};
export type FailureReason = 'auth_delete_failed' | 'auth_verify_failed' | 'completion_failed';
export type WorkerResult = 'claim_not_accepted' | 'completed' | 'manual_recovery_required';

function matchingReceipt(value: unknown, status: 'processing' | 'completed', request: WorkerRequest): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.status === status && row.request_id === request.request_id &&
    (status === 'completed' || row.user_id === request.user_id);
}
/** Auth error codes are more specific than a generic HTTP 404 from a transient API failure. */
function confirmedAbsent(error: AdminResponse['error']): boolean {
  return error?.code === 'user_not_found' && error?.status === 404;
}

export async function executeDeletionOnce(request: WorkerRequest, services: DeletionServices): Promise<WorkerResult> {
  // Claim is an exact-owner and request-id CAS, subject to the private default-OFF gate.
  // Never initiate deletion if a claim fails, throws, or returns an unexpected receipt.
  let claim: RpcResponse;
  try { claim = await services.claim(request); }
  catch { return 'claim_not_accepted'; }
  if (claim.error || !matchingReceipt(claim.data, 'processing', request)) return 'claim_not_accepted';

  // A transport timeout or failed delete response does not prove whether the
  // destructive call committed. Never repeat it. Make one read-only Auth lookup
  // regardless of the delete response, and only complete after definitive absence.
  let reason: FailureReason = 'auth_delete_failed';
  try {
    await services.deleteAuthUser(request.user_id);
  } catch {
    // Ambiguous network result: read-only verification below, no second delete.
  }

  try {
    const observed = await services.inspectAuthUser(request.user_id);
    if (confirmedAbsent(observed.error)) {
      reason = 'completion_failed';
      try {
        const completed = await services.complete(request);
        if (!completed.error && matchingReceipt(completed.data, 'completed', request)) return 'completed';
      } catch {
        // Completion may have committed despite a lost network response.
      }
      // Read-only proof from the durable redacted completion audit. Never retry
      // Auth deletion or the completion mutation after an ambiguous response.
      try {
        const verified = await services.verifyCompletion(request);
        if (!verified.error && matchingReceipt(verified.data, 'completed', request)) return 'completed';
      } catch {
        // Operator recovery remains required if readback is also uncertain.
      }
    } else {
      reason = 'auth_verify_failed';
    }
  } catch {
    reason = 'auth_verify_failed';
  }

  // If Auth deletion succeeded but final receipt failed, a retained failed audit
  // requires a separate operator recovery. Never claim success or delete twice.
  try { await services.recordFailure(request, reason); }
  catch { /* Absence of failure evidence is itself a manual incident. */ }
  return 'manual_recovery_required';
}
