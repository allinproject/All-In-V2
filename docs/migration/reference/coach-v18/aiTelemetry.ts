import type {AiRequestOrigin} from "./requestOrigin.ts";

export type AiRequestOutcome="model_success"|"model_error"|"deterministic_bypass"|"blocked_sync";

export const requestLatencyMs=(startedAtMs:number,nowMs=Date.now())=>Math.max(0,Math.round(nowMs-startedAtMs));

export const nonModelTelemetryRow=({requestId,userId,threadId,source,feature,outcome,startedAtMs,nowMs}: {
  requestId:string;userId:string;threadId:string|null;source:AiRequestOrigin;feature:string;
  outcome:"deterministic_bypass"|"blocked_sync";startedAtMs:number;nowMs?:number;
})=>({
  request_id:requestId,
  user_id:userId,
  thread_id:threadId,
  workflow:source,
  route_key:`${outcome}:${feature}`,
  latency_ms:requestLatencyMs(startedAtMs,nowMs),
});

export const modelTelemetryFields=({source,isFinal,startedAtMs,providerLatencyMs,nowMs}: {
  source:AiRequestOrigin;isFinal:boolean;startedAtMs:number;providerLatencyMs:number|null;nowMs?:number;
})=>({
  task_type:source,
  latency_ms:isFinal?requestLatencyMs(startedAtMs,nowMs):providerLatencyMs,
});

const usageCount=(value:unknown):number|null=>{
  const numeric=Number(value);
  return value===null||value===undefined||!Number.isFinite(numeric)||numeric<0?null:Math.floor(numeric);
};

const pricingRate=(value:unknown):number|null=>{
  const numeric=Number(value);
  return value===null||value===undefined||!Number.isFinite(numeric)||numeric<0?null:numeric;
};

export const providerUsageCounts=(payload:any)=>({
  inputTokens:usageCount(payload?.usage?.input_tokens),
  cachedInputTokens:usageCount(payload?.usage?.input_tokens_details?.cached_tokens),
  outputTokens:usageCount(payload?.usage?.output_tokens),
});

export const estimateAiRequestCost=({inputTokens,cachedInputTokens,outputTokens,pricing}: {
  inputTokens:number|null;cachedInputTokens:number|null;outputTokens:number|null;
  pricing:{input_usd_per_million:unknown;cached_input_usd_per_million:unknown;output_usd_per_million:unknown}|null|undefined;
}):number|null=>{
  const inputRate=pricingRate(pricing?.input_usd_per_million),cachedRate=pricingRate(pricing?.cached_input_usd_per_million),outputRate=pricingRate(pricing?.output_usd_per_million);
  if(inputTokens===null||cachedInputTokens===null||outputTokens===null||inputRate===null||cachedRate===null||outputRate===null)return null;
  const cached=Math.max(0,Math.min(inputTokens,cachedInputTokens)),fresh=Math.max(0,inputTokens-cached);
  return(fresh*inputRate+cached*cachedRate+outputTokens*outputRate)/1_000_000;
};

export async function bestEffortAiTelemetryInsert(admin:any,table:string,row:Record<string,unknown>){
  try{await admin.from(table).insert(row)}catch{}
}
