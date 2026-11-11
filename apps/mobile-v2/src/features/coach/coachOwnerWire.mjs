/**
 * ALL-217 — canonical V2 Coach owner wire decoder.
 *
 * Only data returned by the authenticated Coach owner adapter is accepted.
 * Converts proposed SQL snake_case replies to the compact persistence guard's
 * camelCase contract, without asserting the caller's identity is verified.
 * No Supabase client, service credential or second transcript store.
 */
const valid = s => typeof s==="string" && s.trim().length>0;
const owns = (row, ownerId, threadId) =>
  row && typeof row==="object" && !Array.isArray(row) &&
  row.user_id===ownerId && row.thread_id===threadId;

export function decodeCoachAppendReceipt(raw, request) {
  if(!raw || !request || raw.ok!==true ||
     raw.thread_id!==request.threadId ||
     raw.client_request_id!==request.clientRequestId ||
     raw.user_message_id!==request.userMessageId ||
     raw.assistant_message_id!==request.assistantMessageId ||
     ![request.ownerId,request.threadId,request.clientRequestId,
       request.userMessageId,request.assistantMessageId].every(valid)) return null;
  return {
    ok:true,
    threadId:raw.thread_id,
    clientRequestId:raw.client_request_id,
    userMessageId:raw.user_message_id,
    assistantMessageId:raw.assistant_message_id
  };
}

/**
 * The owner read must expose both account and request correlation.
 * If a public owner read omits them, it CANNOT prove a save: require a
 * privileged owner-scoped receipt reader, never fill missing fields in UI.
 */
export function decodeCoachExchangeRows(rawRows,request) {
  if(!Array.isArray(rawRows) || rawRows.length!==2 || !request ||
     ![request.ownerId,request.threadId,request.clientRequestId,
       request.userMessageId,request.assistantMessageId].every(valid)) return null;
  const mapped=rawRows.map(row=>{
    if(!owns(row,request.ownerId,request.threadId) ||
      row.client_request_id!==request.clientRequestId ||
      !valid(row.id) || !["user","assistant"].includes(row.role) ||
      typeof row.content!=="string" || !valid(row.content)) return null;
    return {ownerId:row.user_id,threadId:row.thread_id,
      clientRequestId:row.client_request_id,
      id:row.id,role:row.role,content:row.content};
  });
  if(mapped.some(x=>!x) ||
      mapped.filter(x=>x.role==="user" && x.id===request.userMessageId).length!==1 ||
      mapped.filter(x=>x.role==="assistant" && x.id===request.assistantMessageId).length!==1) return null;
  return mapped;
}

export function decodeCoachTranscriptPage(rawRows,expected) {
  if(!expected || !valid(expected.ownerId) || !valid(expected.threadId) ||
    !Array.isArray(rawRows) || rawRows.length>50) return null;
  const ids=new Set();
  const result=[];
  for(const row of rawRows) {
    if(!owns(row,expected.ownerId,expected.threadId) ||
      !valid(row.message_id) || !["user","assistant"].includes(row.role) ||
      typeof row.content!=="string" || !valid(row.content) ||
      !valid(row.created_at) || !Number.isFinite(Date.parse(row.created_at)) ||
      ids.has(row.message_id)) return null;
    ids.add(row.message_id);
    result.push({id:row.message_id,threadId:row.thread_id,
      role:row.role,content:row.content,createdAt:row.created_at});
  }
  for(let i=1;i<result.length;i++){
    const prev=result[i-1],curr=result[i];
    if(Date.parse(prev.createdAt)<Date.parse(curr.createdAt) ||
      (prev.createdAt===curr.createdAt && prev.id<=curr.id))return null;
  }
  return result;
}
