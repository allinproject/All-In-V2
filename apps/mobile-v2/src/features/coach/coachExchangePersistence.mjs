/**
 * ALL-217 — V2 Coach exchange persistence adapter.
 *
 * Adapts V1's atomic exchange + stable-id retry behavior to the V2
 * canonical owner. This is an injected adapter: NO database table or RPC
 * is introduced here. A trusted V2 Coach owner must implement append/read.
 * An RPC returning "ok" is not itself proof that both rows were saved.
 */
const id = x => typeof x === "string" && x.trim().length > 0;
const text = (x, limit) => typeof x === "string" && x.trim().length > 0 &&
  x.trim().length <= limit ? x.trim() : null;
function sameExpected(request, row, role) {
  return !!row && row.ownerId === request.ownerId &&
    row.threadId === request.threadId &&
    row.id === (role === "user" ? request.userMessageId : request.assistantMessageId) &&
    row.role === role && row.content ===
      (role === "user" ? request.userContent : request.assistantContent);
}
function blocked(reason) {return {status:"not_saved",reason,retryable:false};}

/**
 * ensureOwner() must independently verify an authenticated *server/domain*
 * owner for this attempt, not echo a client-provided owner string.
 * isCurrent() rejects responses after host session-generation changes.
 * appendExchange() must atomically commit both messages, with stable IDs.
 * readExchange() must return canonical persisted rows scoped to same owner.
 */
export async function persistVerifiedCoachExchange(request, adapter) {
  if (!request || !adapter ||
      ![request.ownerId,request.threadId,request.clientRequestId,
        request.userMessageId,request.assistantMessageId].every(id) ||
      request.userMessageId === request.assistantMessageId ||
      !Number.isSafeInteger(request.sessionGeneration) || request.sessionGeneration < 0 ||
      !(request.userContent = text(request.userContent,12000)) ||
      !(request.assistantContent = text(request.assistantContent,20000))) {
    return blocked("invalid_exchange");
  }
  if (!["ensureOwner","isCurrent","appendExchange","readExchange"].every(
    name => typeof adapter[name] === "function"
  )) return blocked("adapter_incomplete");
  const current = () => adapter.isCurrent(request.ownerId,request.sessionGeneration) === true;
  if (!current()) return blocked("stale_session");
  try {
    const ownerBefore = await adapter.ensureOwner();
    if (!current()) return blocked("stale_session");
    if (ownerBefore !== request.ownerId) return blocked("wrong_owner");
    const wrote = await adapter.appendExchange({
      ownerId:request.ownerId,
      threadId:request.threadId,
      clientRequestId:request.clientRequestId,
      userMessageId:request.userMessageId,
      assistantMessageId:request.assistantMessageId,
      userContent:request.userContent,
      assistantContent:request.assistantContent
    });
    if (!current()) return blocked("stale_session");
    if (!wrote || wrote.ok !== true || wrote.threadId !== request.threadId ||
        wrote.userMessageId !== request.userMessageId ||
        wrote.assistantMessageId !== request.assistantMessageId) {
      return {status:"not_saved",reason:"write_unconfirmed",retryable:true};
    }
    // Read back from canonical owner; never infer from optimistic UI state.
    const rows = await adapter.readExchange(request.ownerId,request.threadId,
      request.userMessageId,request.assistantMessageId);
    if (!current()) return blocked("stale_session");
    const ownerAfter = await adapter.ensureOwner();
    if (!current() || ownerAfter !== request.ownerId) return blocked("stale_session");
    if (!Array.isArray(rows) || rows.length !== 2 ||
        !rows.some(row => sameExpected(request,row,"user")) ||
        !rows.some(row => sameExpected(request,row,"assistant"))) {
      return {status:"not_saved",reason:"readback_mismatch",retryable:true};
    }
    return {
      status:"saved_verified",reason:null,retryable:false,
      receipt:{
        ownerId:request.ownerId,
        threadId:request.threadId,
        clientRequestId:request.clientRequestId,
        userMessageId:request.userMessageId,
        assistantMessageId:request.assistantMessageId
      }
    };
  } catch {
    // The write might have committed despite a lost network response. A retry
    // MUST reuse the identical IDs and payload; canonical owner handles replay.
    return {status:"not_saved",reason:"owner_unavailable",retryable:true};
  }
}
