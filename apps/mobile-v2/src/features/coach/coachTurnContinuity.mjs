/** ALL-217: read-only conversational anchors; never durable memory or action authority. */
const REFERENCE=/\b(?:last time|earlier|you said|you recommended|we talked about|yesterday|that recommendation|following up|follow up|same plan|same workout|same meal)\b/i;
const RECOMMENDED=/\b(?:recommend|suggest|try|plan|switch|adjust|change|keep)\b/i;
export const referencesEarlierCoachTurn = value => typeof value==="string" && REFERENCE.test(value);
export function projectCoachThreadAnchors({accountId,threadId,message,rows,recentLimit=4,maxAnchors=4}={}){
  if(!accountId||!threadId||!referencesEarlierCoachTurn(message)||!Array.isArray(rows)||rows.length<1||rows.length>128)return null;
  if(!Number.isInteger(recentLimit)||recentLimit<1||recentLimit>50||!Number.isInteger(maxAnchors)||maxAnchors<1||maxAnchors>4)return null;
  if(!rows.every(r=>r&&r.accountId===accountId&&r.threadId===threadId&&["user","assistant"].includes(r.role)&&typeof r.content==="string"&&r.content.trim()&&Number.isFinite(Date.parse(r.createdAt))))return null;
  if(rows.some((r,i)=>i>0&&Date.parse(r.createdAt)<Date.parse(rows[i-1].createdAt)))return null;
  const older=rows.slice(0,-recentLimit);
  const selected=older.map((r,i)=>({r,i,score:(r.role==="assistant"&&RECOMMENDED.test(r.content)?5:0)+(r.content.toLowerCase().includes("run")&&message.toLowerCase().includes("run")?3:0)})).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,maxAnchors).sort((a,b)=>a.i-b.i);
  if(!selected.length)return null;
  return {authority:"conversation_only",accountId,threadId,guardrail:"Old chat snippets are not accepted plans, saved actions, profile facts or canonical athlete records.",anchors:selected.map(({r})=>({role:r.role,createdAt:r.createdAt,content:r.content.replace(/\s+/g," ").trim().slice(0,900)}))};
}
