/**
 * ALL-217 / ALL-210 — default-OFF Coach HTTP boundary.
 * The actual Deno Edge entrypoint supplies verified Supabase Auth + canonical
 * owner dependencies. No model key, service role, provider or arbitrary
 * "assistant" message can be injected through public JSON.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token=/^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/;
const maxBodyBytes=14*1024;
const headers={
 "content-type":"application/json; charset=utf-8",
 "cache-control":"no-store","x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer"
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const isId=value=>typeof value==="string"&&UUID.test(value);
const hasOnly=(obj,allowed)=>Object.keys(obj).every(key=>allowed.includes(key));
async function parseBoundedJson(req){
 const supplied=req.headers.get("content-length");
 if(supplied!==null&&(!/^\d+$/.test(supplied)||Number(supplied)>maxBodyBytes))
  return null;
 const reader=req.body?.getReader();
 if(!reader)return null;
 const pieces=[];let n=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!value)continue;
   n+=value.length;
   if(n>maxBodyBytes){await reader.cancel();return null}
   pieces.push(value);
  }
  const bytes=new Uint8Array(n);let offset=0;
  for(const part of pieces){bytes.set(part,offset);offset+=part.length}
  const data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  return data&&typeof data==="object"&&!Array.isArray(data)?data:null;
 }catch{return null}
}
/**
 * Dependencies are injected from trusted server code, never request JSON:
 * verifyUser(bearer) -> verified {id}, createOrResumeThread({ownerId,
 * candidateThreadId}), readTranscriptPage({ownerId,threadId,...}),
 * executeExchange({bearerToken,ownerId,threadId,clientRequestId,
 * userMessageId,assistantMessageId,userContent}).
 * The caller must pass enabled=true only AFTER database schema, model budget,
 * authorized owner-context and approved provider configuration are accepted.
 */
export async function handleCoachRuntimeRequest(req,deps,{enabled=false}={}){
 if(!enabled)return json(503,{code:"coach_disabled"});
 if(req.method!=="POST")return json(405,{code:"method_not_allowed"});
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
  return json(415,{code:"unsupported_media_type"});
 const bearer=req.headers.get("authorization")??"";
 const match=token.exec(bearer);
 if(!match||bearer.length>8192)return json(401,{code:"unauthorized"});
 if(!deps||!["verifyUser","createOrResumeThread","readTranscriptPage","executeExchange"]
   .every(name=>typeof deps[name]==="function"))
  return json(503,{code:"coach_unconfigured"});
 const body=await parseBoundedJson(req);
 if(!body||!["open","history","send"].includes(body.action)||
    !isId(body.ownerId))return json(400,{code:"invalid_coach_request"});
 const validOpen=body.action==="open"&&
   hasOnly(body,["action","ownerId","candidateThreadId"])&&isId(body.candidateThreadId);
 const validHistory=body.action==="history"&&
   hasOnly(body,["action","ownerId","threadId","cursor","limit"])&&isId(body.threadId)&&
   (body.limit===undefined||(Number.isInteger(body.limit)&&body.limit>=1&&body.limit<=50))&&
   (body.cursor===undefined||body.cursor===null||
    (typeof body.cursor==="object"&&!Array.isArray(body.cursor)&&
     hasOnly(body.cursor,["beforeCreatedAt","beforeMessageId"])&&
     typeof body.cursor.beforeCreatedAt==="string"&&
     Number.isFinite(Date.parse(body.cursor.beforeCreatedAt))&&
     isId(body.cursor.beforeMessageId)));
 const validSend=body.action==="send"&&
   hasOnly(body,["action","ownerId","threadId","clientRequestId",
     "userMessageId","assistantMessageId","message"])&&
   [body.threadId,body.clientRequestId,body.userMessageId,body.assistantMessageId].every(isId)&&
   new Set([body.clientRequestId,body.userMessageId,body.assistantMessageId]).size===3&&
   typeof body.message==="string"&&body.message.trim().length>0&&
   body.message.trim().length<=12000;
 if(!validOpen&&!validHistory&&!validSend)
  return json(400,{code:"invalid_coach_request"});
 try{
  const owner=await deps.verifyUser(match[1]);
  if(owner?.id!==body.ownerId)return json(401,{code:"unauthorized"});
  let output;
  if(validOpen){
   const result=await deps.createOrResumeThread({
    ownerId:body.ownerId,candidateThreadId:body.candidateThreadId});
   if(result?.ownerId!==body.ownerId||!isId(result?.threadId))
    return json(503,{code:"coach_owner_unavailable"});
   output={threadId:result.threadId};
  }else if(validHistory){
   const result=await deps.readTranscriptPage({
    ownerId:body.ownerId,threadId:body.threadId,
    beforeCreatedAt:body.cursor?.beforeCreatedAt??null,
    beforeMessageId:body.cursor?.beforeMessageId??null,
    limit:body.limit??40});
   if(!result||!Array.isArray(result.messages)||result.messages.length>50||
      typeof result.hasMore!=="boolean"||
      !result.messages.every(r=>r.threadId===body.threadId&&
        ["user","assistant"].includes(r.role)&&isId(r.id)&&
        typeof r.content==="string"))
    return json(503,{code:"coach_history_unavailable"});
   output={messages:result.messages,hasMore:result.hasMore,nextCursor:result.nextCursor??null};
  }else{
   const result=await deps.executeExchange({
    bearerToken:match[1],ownerId:body.ownerId,threadId:body.threadId,
    clientRequestId:body.clientRequestId,userMessageId:body.userMessageId,
    assistantMessageId:body.assistantMessageId,userContent:body.message.trim()});
   if(result?.status!=="saved_verified"||result?.receipt?.ownerId!==body.ownerId||
      result.receipt.threadId!==body.threadId||
      result.receipt.clientRequestId!==body.clientRequestId||
      result.receipt.userMessageId!==body.userMessageId||
      result.receipt.assistantMessageId!==body.assistantMessageId||
      typeof result.message!=="string"||!result.message.trim())
    return json(503,{code:"coach_turn_unavailable"});
   output={message:result.message,receipt:result.receipt,replayed:result.replayed===true};
  }
  const after=await deps.verifyUser(match[1]);
  if(after?.id!==body.ownerId)return json(401,{code:"unauthorized"});
  return json(200,{status:"ok",...output});
 }catch{
  return json(503,{code:"coach_unavailable"});
 }
}
