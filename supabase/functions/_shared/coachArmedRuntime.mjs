/**
 * ALL-217 staged server-only composition. Not deployed or enabled.
 * Missing owner readers, approved budget RPCs or provider keys fail closed.
 */
import {createCoachSupabaseDependencies} from "./coachSupabasePersistence.mjs";
import {createCoachCanonicalTrainingReader} from "./coachCanonicalTrainingReader.mjs";
import {createCoachTrainingAuthServices} from "./coachTrainingAuthServices.mjs";
import {createCoachBudgetSupabase} from "./coachBudgetSupabase.mjs";
import {createCoachOpenAiResponsesTransport} from "./coachOpenAiResponsesTransport.mjs";
import {createCoachModelGenerator} from "./coachModelAdmission.mjs";
import {executeCoachServerExchange} from "./coachServerPersistence.mjs";
const POLICY=`You are ALL IN 365 Coach. Treat canonical accepted plans and active
athlete restrictions as authoritative; old chat and generic templates cannot
override them. Do not invent exercises, working weights, plan structure,
history, injuries, recovery data or completion evidence. Partial history is
not zero activity. A proposed change is not saved. Do not recommend restricted
movements. Without a verified current plan, say the plan is unavailable.
Structured changes require the separate reviewed ALL-240 approval path.
Coach has no authority to write a training plan or user data.`;
export function createCoachArmedRuntime({
 userClient,serverClient,bearerToken,apiKey,model,
 inputUsdPerMillion,outputUsdPerMillion,fetchImpl
}={}){
 const auth=createCoachTrainingAuthServices({userClient,bearerToken});
 const readContext=createCoachCanonicalTrainingReader({
  userClient,verifySession:auth.verifySession,
  readRestrictions:auth.readRestrictions,readAccessGate:auth.readAccessGate,
  resolveAthleteDate:auth.resolveAthleteDate
 });
 const budget=createCoachBudgetSupabase({serviceClient:serverClient});
 const invokeModel=createCoachOpenAiResponsesTransport({
  apiKey,model,inputUsdPerMillion,outputUsdPerMillion,fetchImpl
 });
 const providerGenerate=createCoachModelGenerator({
  readContext,buildInstructions:async()=>POLICY,
  reserveBudget:budget.reserveBudget,settleBudget:budget.settleBudget,
  releaseBudget:budget.releaseBudget,invokeModel,maxCostUsd:0.005,
  maxOutputTokens:256
 });
 const deps=createCoachSupabaseDependencies({
  userClient,serverClient,bearerToken,providerGenerate
 });
 return {verifyUser:deps.verifyUser,
  createOrResumeThread:deps.createOrResumeThread,
  readTranscriptPage:deps.readTranscriptPage,
  executeExchange:request=>executeCoachServerExchange(request,deps)};
}
