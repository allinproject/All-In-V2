/**
 * ALL-217/230/232 — trusted, default-OFF Coach model admission.
 * No HTTP or database credentials here; the Edge host supplies verified
 * canonical owner readers, durable budget reservation/settlement, the vetted
 * V1-v18-compatible instruction builder, and the model transport.
 * A model cannot approve a write or invent owner/context certification.
 */
import {prepareCoachTurnContext} from "../../../apps/mobile-v2/src/features/coach/coachTurnContext.mjs";

const uuid=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const text=(x,max)=>typeof x==="string"&&x.trim().length>0&&x.trim().length<=max;
const finite=(x,min,max)=>typeof x==="number"&&Number.isFinite(x)&&x>=min&&x<=max;
const rejected=code=>{throw new Error(code)};
const normalized=s=>s.toLowerCase().replace(/\s+/g," ").trim();

/**
 * maxCostUsd/maxOutputTokens are trusted, reviewed server settings, not
 * caller choices. reserveBudget/settleBudget/releaseBudget must use a durable,
 * per-owner, per-request idempotent ledger. No in-memory token "rate limit".
 *
 * readContext returns a bounded, actual owner-read result of the form:
 * {ownerId,accessGateReady,restrictionsVerified,historyCertification,history,
 *  conversationRows?}. Its verified certification must originate from the
 * owner reader, never from the mobile request or the model.
 */
export function createCoachModelGenerator({
 readContext,buildInstructions,reserveBudget,settleBudget,releaseBudget,
 invokeModel,now=()=>new Date().toISOString(),
 maxCostUsd,maxOutputTokens
}={}){
 const methods=[readContext,buildInstructions,reserveBudget,settleBudget,
   releaseBudget,invokeModel];
 if(!methods.every(x=>typeof x==="function")||
    !finite(maxCostUsd,0.000001,0.05)||
    !Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>1024)
  throw Error("coach_model_provider_not_configured");
 return async function providerGenerate(input){
  if(!input||![input.ownerId,input.threadId,input.clientRequestId].every(uuid)||
     !text(input.userContent,12000))rejected("coach_model_turn_invalid");
  const ownerId=input.ownerId,clientRequestId=input.clientRequestId;
  const currentTime=now();
  if(typeof currentTime!=="string"||!Number.isFinite(Date.parse(currentTime)))
   rejected("coach_model_clock_unavailable");
  const read=await readContext({
   ownerId,threadId:input.threadId,clientRequestId,
   message:input.userContent.trim(),readAt:currentTime
  });
  if(!read||read.ownerId!==ownerId)rejected("coach_model_owner_context_unverified");
  const context=prepareCoachTurnContext({
   authenticatedUserId:ownerId,accountId:ownerId,threadId:input.threadId,
   accessGateReady:read.accessGateReady===true,
   restrictionsVerified:read.restrictionsVerified===true,
   historyCertification:read.historyCertification,history:read.history,
   conversationRows:read.conversationRows,
   message:input.userContent.trim(),currentTime
  });
  if(context.kind!=="ready")rejected("coach_model_"+context.reason);
  if(context.accountId!==ownerId||context.noWriteAuthority!==true)
   rejected("coach_model_context_not_read_only");
  const instructions=await buildInstructions({ownerId,
    context,message:input.userContent.trim()});
  if(!text(instructions,25000))rejected("coach_model_instructions_unavailable");

  // Reject over-budget/oversized prompts BEFORE making a durable hold.
  // Only trusted server-owned model transports expose this deterministic
  // preflight; never accept cost limits from the caller's request body.
  if(typeof invokeModel.preflight==="function"){
   const check=invokeModel.preflight({
    instructions,userContent:input.userContent.trim(),context,maxOutputTokens
   });
   if(!check||!finite(check.worstCostUsd,0,maxCostUsd))
    rejected("coach_model_preflight_budget_denied");
  }

  // A durable reservation is required before any model request. The server
  // must bind this to the authenticated owner and stable client request ID.
  const reservation=await reserveBudget({ownerId,clientRequestId,
    maximumUsd:maxCostUsd,maxOutputTokens});
  if(!reservation||reservation.approved!==true||
     reservation.ownerId!==ownerId||
     reservation.clientRequestId!==clientRequestId||
     !uuid(reservation.reservationId)||
     !finite(reservation.maximumUsd,0.000001,maxCostUsd))
    rejected("coach_model_budget_denied");

  let answer;
  try{
   answer=await invokeModel({
    instructions,userContent:input.userContent.trim(),context,
    ownerId,clientRequestId,maxOutputTokens,
    reservationId:reservation.reservationId
   });
  }catch{
   // A transport error is ambiguous: the upstream provider may have accepted
   // and billed the request before the connection failed. Hold the durable
   // reservation for reconciliation; never refund on a timeout/unknown 5xx.
   rejected("coach_model_transport_unconfirmed");
  }
  // A charged model call must be settled even when the answer is later
  // rejected by content/action policy. Missing or over-budget metering stays
  // reserved and fails closed; never fabricate a cheaper provider receipt.
  if(!answer||!answer.usage||
     !Number.isSafeInteger(answer.usage.inputTokens)||answer.usage.inputTokens<0||
     !Number.isSafeInteger(answer.usage.outputTokens)||answer.usage.outputTokens<0||
     !finite(answer.usage.costUsd,0,reservation.maximumUsd))
    rejected("coach_model_output_or_metering_invalid");
  const settled=await settleBudget({ownerId,clientRequestId,
    reservationId:reservation.reservationId,
    inputTokens:answer.usage.inputTokens,
    outputTokens:answer.usage.outputTokens,costUsd:answer.usage.costUsd});
  if(settled?.confirmed!==true||settled.ownerId!==ownerId||
      settled.clientRequestId!==clientRequestId)
   rejected("coach_model_spend_unconfirmed");
  // The requested output ceiling is a hard server admission limit. Even if
  // the model transport reports a larger completion, settle actual metered
  // spend first, then reject it rather than displaying an over-limit answer.
  if(answer.usage.outputTokens>maxOutputTokens)
    rejected("coach_model_output_token_limit_exceeded");
  // A proposal must be handled through ALL-240, not this read-only channel.
  if(!text(answer.message,20000)||Object.hasOwn(answer,"proposed_action"))
    rejected("coach_model_output_or_metering_invalid");
  const output=normalized(answer.message);
  // Explicit disallowed movements must not reappear in generated plans.
  // Fail closed instead of displaying a plausible-but-unsafe rewritten plan.
  const restricted=context.activeRestrictions.filter(r=>
    ["exercise","equipment","pain_or_return"].includes(r.category)&&
    r.subject.trim().length>=3);
  if(restricted.some(r=>output.includes(normalized(r.subject))))
    rejected("coach_model_hard_restriction_violated");
  return {message:answer.message.trim()};
 };
}
