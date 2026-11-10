export const DEFAULT_AI_INPUT_CHAR_BUDGET=48_000;
export const AI_OUTPUT_TOKEN_CAP_BY_TIER={fast:500,standard:900,advanced:1400} as const;
export const MAX_AI_OUTPUT_TOKENS=AI_OUTPUT_TOKEN_CAP_BY_TIER.advanced;
export const MAX_AI_PROVIDER_RETRIES=2;
export const MAX_AI_PROVIDER_ATTEMPTS=1+MAX_AI_PROVIDER_RETRIES;
export const MAX_AI_TOOL_CALLS=3;

export type AiModelTier=keyof typeof AI_OUTPUT_TOKEN_CAP_BY_TIER;
export type BoundedAiInput =
  | {ok:true;input:unknown;serialized:string;trimmed:boolean;originalChars:number;finalChars:number}
  | {ok:false;input:null;serialized:null;trimmed:boolean;originalChars:number;finalChars:number};

const serializedChars=(value:unknown)=>JSON.stringify(value).length;

export const enforceAiInputBudget=(input:any,maxChars=DEFAULT_AI_INPUT_CHAR_BUDGET):BoundedAiInput=>{
  const limit=Math.max(1,Math.floor(maxChars));
  const originalSerialized=JSON.stringify(input);
  if(originalSerialized.length<=limit)return{ok:true,input,serialized:originalSerialized,trimmed:false,originalChars:originalSerialized.length,finalChars:originalSerialized.length};
  const history=Array.isArray(input?.recent_conversation)?input.recent_conversation:[];
  if(history.length){
    for(let start=1;start<=history.length;start+=1){
      const candidate={...input,recent_conversation:history.slice(start)};
      const serialized=JSON.stringify(candidate);
      if(serialized.length<=limit)return{ok:true,input:candidate,serialized,trimmed:true,originalChars:originalSerialized.length,finalChars:serialized.length};
    }
  }
  return{ok:false,input:null,serialized:null,trimmed:history.length>0,originalChars:originalSerialized.length,finalChars:serializedChars({...input,recent_conversation:[]})};
};

export const resolveAiOutputTokenCap=(tier:AiModelTier,requestedCap?:unknown):number=>{
  const configured=AI_OUTPUT_TOKEN_CAP_BY_TIER[tier];
  const requested=Number(requestedCap);
  if(!Number.isFinite(requested)||requested<=0)return configured;
  return Math.min(configured,Math.max(1,Math.floor(requested)));
};

export const canStartAiProviderAttempt=(attemptsStarted:number):boolean=>
  Math.max(0,Math.floor(attemptsStarted))<MAX_AI_PROVIDER_ATTEMPTS;

export const canStartAiToolCall=(toolCallsStarted:number):boolean=>
  Math.max(0,Math.floor(toolCallsStarted))<MAX_AI_TOOL_CALLS;
