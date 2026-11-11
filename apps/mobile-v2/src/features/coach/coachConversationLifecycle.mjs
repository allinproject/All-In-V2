/**
 * ALL-217 — Coach conversation request/reply lifecycle, dependency-free.
 *
 * This is a guard for a future canonical Coach message writer, not a store.
 * Returned state contains turn metadata only; it never contains message text.
 * Trusted host must supply the current authenticated owner and generation.
 * Save receipts must come from the canonical Coach writer, never the model.
 */
const validId = v => typeof v === "string" && v.trim().length > 0;
const validGeneration = v => Number.isSafeInteger(v) && v >= 0;
const sameIdentity = (a,b) => a.ownerId === b.ownerId &&
  a.sessionGeneration === b.sessionGeneration;

export function newCoachSessionScope(ownerId, sessionGeneration) {
  if (!validId(ownerId) || !validGeneration(sessionGeneration)) {
    return {kind:"blocked",reason:"invalid_session_scope"};
  }
  return {kind:"ready",ownerId,sessionGeneration,turns:[]};
}

export function startCoachTurn(state, request) {
  if (state?.kind !== "ready" || !request || !validId(request.ownerId) ||
    !validGeneration(request.sessionGeneration)) return {kind:"blocked",reason:"invalid_turn"};
  if (!sameIdentity(state,request)) return {kind:"blocked",reason:"stale_session"};
  if (![request.threadId,request.turnId,request.clientRequestId].every(validId))
    return {kind:"blocked",reason:"missing_turn_identity"};
  if (!Array.isArray(state.turns) || state.turns.length >= 128)
    return {kind:"blocked",reason:"too_many_pending_turns"};
  const existing=state.turns.find(t=>t.clientRequestId===request.clientRequestId);
  if (existing) {
    if (existing.threadId!==request.threadId || existing.turnId!==request.turnId)
      return {kind:"blocked",reason:"request_id_reused"};
    return {kind:"unchanged",state,turn:existing};
  }
  if (state.turns.some(t=>t.turnId===request.turnId))
    return {kind:"blocked",reason:"turn_id_reused"};
  const turn={threadId:request.threadId,turnId:request.turnId,
    clientRequestId:request.clientRequestId,status:"requested",
    responseId:null,saveReceipt:null};
  return {kind:"updated",state:{...state,turns:[...state.turns,turn]},turn};
}

/**
 * A provider response is not durable storage. Retain only the correlation ID
 * until a canonical owner receipt is independently verified.
 */
export function receiveCoachResponse(state, response) {
  if (state?.kind!=="ready" || !response || !validId(response.ownerId) ||
    !validGeneration(response.sessionGeneration)) return {kind:"blocked",reason:"invalid_response"};
  if (!sameIdentity(state,response)) return {kind:"blocked",reason:"stale_session"};
  const index=state.turns.findIndex(t=>t.clientRequestId===response.clientRequestId);
  if (index<0) return {kind:"blocked",reason:"unknown_request"};
  const prior=state.turns[index];
  if (prior.threadId!==response.threadId || prior.turnId!==response.turnId ||
    !validId(response.responseId)) return {kind:"blocked",reason:"response_mismatch"};
  if (prior.responseId) {
    if (prior.responseId!==response.responseId) return {kind:"blocked",reason:"conflicting_response"};
    return {kind:"unchanged",state,turn:prior};
  }
  const turn={...prior,responseId:response.responseId,status:"generated_unverified"};
  return {kind:"updated",state:{...state,turns:state.turns.map((t,i)=>i===index?turn:t)},turn};
}

/**
 * Receipt is a minimal verified canonical reference. A caller should never
 * set receipt.ownerVerified/readbackVerified based on an LLM assertion.
 */
export function verifyCoachMessageReceipt(state,receipt) {
  if (state?.kind!=="ready" || !receipt || !validId(receipt.ownerId) ||
    !validGeneration(receipt.sessionGeneration)) return {kind:"blocked",reason:"invalid_receipt"};
  if (!sameIdentity(state,receipt)) return {kind:"blocked",reason:"stale_session"};
  const index=state.turns.findIndex(t=>t.clientRequestId===receipt.clientRequestId);
  if(index<0) return {kind:"blocked",reason:"unknown_request"};
  const prior=state.turns[index];
  if (!prior.responseId || receipt.responseId!==prior.responseId ||
    receipt.threadId!==prior.threadId || receipt.turnId!==prior.turnId ||
    !validId(receipt.messageId)) return {kind:"blocked",reason:"receipt_mismatch"};
  if (receipt.ownerVerified!==true || receipt.readbackVerified!==true)
    return {kind:"blocked",reason:"unverified_receipt"};
  if(prior.saveReceipt) {
    if(prior.saveReceipt.messageId!==receipt.messageId)
      return {kind:"blocked",reason:"conflicting_receipt"};
    return {kind:"unchanged",state,turn:prior};
  }
  if(state.turns.some(t=>t.saveReceipt?.messageId===receipt.messageId))
    return {kind:"blocked",reason:"message_id_reused"};
  const turn={...prior,status:"saved_verified",
    saveReceipt:{messageId:receipt.messageId,threadId:receipt.threadId}};
  return {kind:"updated",state:{...state,turns:state.turns.map((t,i)=>i===index?turn:t)},turn};
}

/** Identity changes invalidate all prior in-flight turn metadata. */
export function switchCoachSessionScope(state, ownerId, sessionGeneration) {
  if (!validId(ownerId) || !validGeneration(sessionGeneration))
    return {kind:"blocked",reason:"invalid_session_scope"};
  if(state?.kind==="ready" && state.ownerId===ownerId &&
      state.sessionGeneration===sessionGeneration) return state;
  return newCoachSessionScope(ownerId,sessionGeneration);
}
