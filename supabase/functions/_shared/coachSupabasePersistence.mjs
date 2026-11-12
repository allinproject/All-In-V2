/**
 * ALL-217: trusted Supabase binding for the V2 Coach host.
 * This module does NOT deploy an Edge handler or invoke an AI model.
 * The caller creates userClient with the Bearer JWT and serverClient with
 * server-only service credentials. Never create either from request JSON.
 */
import {decodeCoachTranscriptPage} from "../../../apps/mobile-v2/src/features/coach/coachOwnerWire.mjs";

const valid=x=>typeof x==="string"&&x.trim().length>0;
const uuid=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
function unwrap(result){
 if(!result||result.error)throw Error("canonical_coach_owner_unavailable");
 return result.data;
}
const asInt=x=>typeof x==="number"&&Number.isSafeInteger(x)?x:null;
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");

export async function hashCoachRequestTuple(input,webCrypto=globalThis.crypto){
 if(!input||!webCrypto?.subtle||typeof TextEncoder!=="function"||
   !["ownerId","threadId","clientRequestId","userMessageId",
     "assistantMessageId","userContent"].every(k=>valid(input[k]))) {
   throw Error("coach_fingerprint_unavailable");
 }
 const tuple=["allin-v2-coach-exchange-v1",input.ownerId,input.threadId,
   input.clientRequestId,input.userMessageId,input.assistantMessageId,
   input.userContent.trim()];
 const digest=await webCrypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(tuple)));
 return hex(digest);
}

export function createCoachSupabaseDependencies({userClient,serverClient,
  bearerToken,providerGenerate,webCrypto=globalThis.crypto}={}){
 if(!valid(bearerToken)||typeof userClient?.auth?.getUser!=="function"||
    typeof userClient?.rpc!=="function"||typeof serverClient?.rpc!=="function"||
    typeof providerGenerate!=="function")throw Error("trusted_coach_host_not_configured");
 const verifyUser=async token=>{
   if(token!==bearerToken)throw Error("token_context_mismatch");
   const {data,error}=await userClient.auth.getUser(token);
   if(error||!uuid(data?.user?.id))throw Error("coach_session_invalid");
   return {id:data.user.id};
 };
 const assertOwner=async ownerId=>{
   if(!uuid(ownerId))throw Error("coach_owner_invalid");
   const current=await verifyUser(bearerToken);
   if(current.id!==ownerId)throw Error("coach_account_changed");
 };
 return {
  verifyUser,
  createOrResumeThread:async p=>{
   if(!p||!uuid(p.ownerId)||!uuid(p.candidateThreadId))
    throw Error("coach_thread_identity_invalid");
   await assertOwner(p.ownerId);
   const canonicalThreadId=unwrap(await userClient.rpc("v2_coach_create_thread",{
    p_expected_user_id:p.ownerId,p_thread_id:p.candidateThreadId
   }));
   if(!uuid(canonicalThreadId))throw Error("coach_thread_readback_invalid");
   await assertOwner(p.ownerId);
   return {ownerId:p.ownerId,threadId:canonicalThreadId};
  },
  readTranscriptPage:async p=>{
   const beforeCreatedAt=p?.beforeCreatedAt??null;
   const beforeMessageId=p?.beforeMessageId??null;
   const limit=p?.limit??40;
   if(!p||!uuid(p.ownerId)||!uuid(p.threadId)||
      !Number.isSafeInteger(limit)||limit<1||limit>50||
      ((beforeCreatedAt===null)!==(beforeMessageId===null))||
      (beforeCreatedAt!==null&&
       (typeof beforeCreatedAt!=="string"||!Number.isFinite(Date.parse(beforeCreatedAt))||
        !uuid(beforeMessageId))))
    throw Error("coach_transcript_cursor_invalid");
   await assertOwner(p.ownerId);
   const rawRows=unwrap(await userClient.rpc("v2_coach_read_messages",{
    p_expected_user_id:p.ownerId,p_thread_id:p.threadId,
    p_before_created_at:beforeCreatedAt,
    p_before_message_id:beforeMessageId,p_limit:limit
   }));
   const messages=decodeCoachTranscriptPage(rawRows,{ownerId:p.ownerId,threadId:p.threadId});
   if(!messages||messages.length>limit)throw Error("coach_transcript_readback_invalid");
   await assertOwner(p.ownerId);
   const hasMore=messages.length===limit;
   const oldest=messages.at(-1);
   return {messages,hasMore,nextCursor:hasMore?{
    beforeCreatedAt:oldest.createdAt,beforeMessageId:oldest.id
   }:null};
  },
  fingerprintTurn:payload=>hashCoachRequestTuple(payload,webCrypto),
  providerGenerate,
  claimTurn:async p=>{
   const row=unwrap(await serverClient.rpc("v2_coach_claim_turn",{
    p_user_id:p.ownerId,p_thread_id:p.threadId,
    p_client_request_id:p.clientRequestId,p_user_message_id:p.userMessageId,
    p_assistant_message_id:p.assistantMessageId,p_request_fingerprint:p.requestFingerprint
   }));
   if(!row||typeof row!=="object"||!valid(row.action))
    throw Error("coach_claim_invalid");
   return {action:row.action,executionVersion:asInt(row.execution_version)};
  },
  appendPair:async p=>unwrap(await serverClient.rpc("v2_coach_append_exchange",{
   p_expected_user_id:p.ownerId,p_thread_id:p.threadId,
   p_client_request_id:p.clientRequestId,p_user_message_id:p.userMessageId,
   p_assistant_message_id:p.assistantMessageId,
   p_execution_version:p.executionVersion,
   p_user_content:p.userContent,p_assistant_content:p.assistantContent
  })),
  readPair:async p=>{
   const rows=unwrap(await userClient.rpc("v2_coach_read_exchange",{
    p_expected_user_id:p.ownerId,p_thread_id:p.threadId,
    p_client_request_id:p.clientRequestId,
    p_user_message_id:p.userMessageId,p_assistant_message_id:p.assistantMessageId
   }));
   if(!Array.isArray(rows))throw Error("coach_readback_invalid");
   return rows;
  },
  finishClaim:async p=>unwrap(await serverClient.rpc("v2_coach_finish_turn",{
   p_user_id:p.ownerId,p_thread_id:p.threadId,
   p_client_request_id:p.clientRequestId,
   p_assistant_message_id:p.assistantMessageId,
   p_execution_version:p.executionVersion
  }))
 };
}
