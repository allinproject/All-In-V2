/**
 * ALL-217 private service-only bridge to the serialized Coach budget ledger.
 * No authorization from a mobile request: serviceClient MUST be a trusted
 * server-credential client used only after account/session verification.
 * Candidate SQL: V2-COACH-BUDGET-LEDGER-REVIEW-CANDIDATE.sql.
 */
const uuid=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const usd=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&x<=0.01;
const fail=()=>{throw Error("coach_budget_owner_unavailable")};
const unwrap=r=>{if(r?.error||!r||!r.data||typeof r.data!=="object")fail();return r.data};
export function createCoachBudgetSupabase({serviceClient}={}){
 if(typeof serviceClient?.rpc!=="function")
  throw Error("coach_budget_server_not_configured");
 return {
  reserveBudget:async({ownerId,clientRequestId,maximumUsd,maxOutputTokens}={})=>{
   if(!uuid(ownerId)||!uuid(clientRequestId)||!usd(maximumUsd)||
      !Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<16||maxOutputTokens>1024)fail();
   const row=unwrap(await serviceClient.rpc("v2_coach_budget_reserve",{
    p_user_id:ownerId,p_client_request_id:clientRequestId,
    p_maximum_usd:maximumUsd,p_max_output_tokens:maxOutputTokens
   }));
   if(row.approved!==true||row.ownerId!==ownerId||
      row.clientRequestId!==clientRequestId||
      !uuid(row.reservationId)||!usd(row.maximumUsd)||
      row.maximumUsd>maximumUsd)fail();
   return row;
  },
  settleBudget:async({ownerId,clientRequestId,reservationId,
   inputTokens,outputTokens,costUsd}={})=>{
   if(![ownerId,clientRequestId,reservationId].every(uuid)||
      !Number.isSafeInteger(inputTokens)||inputTokens<0||
      !Number.isSafeInteger(outputTokens)||outputTokens<0||
      typeof costUsd!=="number"||!Number.isFinite(costUsd)||
      costUsd<0||costUsd>0.01)fail();
   const row=unwrap(await serviceClient.rpc("v2_coach_budget_settle",{
    p_user_id:ownerId,p_client_request_id:clientRequestId,
    p_reservation_id:reservationId,p_input_tokens:inputTokens,
    p_output_tokens:outputTokens,p_cost_usd:costUsd
   }));
   if(row.confirmed!==true||row.ownerId!==ownerId||
      row.clientRequestId!==clientRequestId)fail();
   return row;
  },
  // No release RPC by design: a timeout does not prove the provider did not
  // charge. Reservations remain held until a reviewed reconciliation flow.
  releaseBudget:async()=>{throw Error("coach_budget_release_requires_proof")}
 };
}
