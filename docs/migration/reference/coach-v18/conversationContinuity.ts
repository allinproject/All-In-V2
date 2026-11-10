import {normalize} from './core.ts';

export type ContinuityRow={role:'user'|'assistant';content:string;created_at:string};
export type ContinuityContext={
 authority:'conversation_only';
 guardrail:string;
 anchors:ContinuityRow[];
};

const MAX_ANCHOR_CHARS=900;
const REFERENCE=/\b(yesterday(?:'s)?|last time|earlier|before|that idea|that suggestion|that recommendation|that plan|what we talked about|we talked about|you said|you recommended|your idea|follow(?:ing)? up|same (?:thing|meal|lunch|dinner|breakfast|plan|workout|run))\b/;
const RECOMMENDATION=/\b(recommend|suggest|i would|i'd|you could|you should|try|plan|idea|option|keep|switch|move|adjust|change)\b/;
const DOMAIN_WORDS=['run','running','workout','training','strength','lift','ride','bike','cycling','swim','race','meal','lunch','dinner','breakfast','recipe','food','fuel','fueling','hydration','recovery','sleep','plan','prep','pantry'];

export function continuityReferenceIntent(message:string){return REFERENCE.test(normalize(message));}

export function selectContinuityAnchors(rows:ContinuityRow[],message:string,recentLimit:number,maxAnchors=4):ContinuityRow[]{
 if(!continuityReferenceIntent(message)||recentLimit<1||rows.length<=recentLimit)return [];
 const recentStart=Math.max(0,rows.length-recentLimit),older=rows.slice(0,recentStart),request=normalize(message),domains=DOMAIN_WORDS.filter(word=>new RegExp(`\\b${word}\\b`).test(request));
 const scored=older.map((row,index)=>{const text=normalize(row.content);let score=0;if(row.role==='assistant'&&RECOMMENDATION.test(text))score+=5;if(row.role==='assistant'&&/\b(yesterday|earlier|last time|you said|you recommended|that idea|that suggestion|that recommendation|your idea)\b/.test(request))score+=2;for(const domain of domains)if(new RegExp(`\\b${domain}\\b`).test(text))score+=3;score+=index/Math.max(1,older.length);return{row,score,index};}).filter(item=>item.score>=2);
 scored.sort((a,b)=>b.score-a.score||b.index-a.index);
 return scored.slice(0,Math.max(1,Math.min(4,maxAnchors))).sort((a,b)=>a.index-b.index).map(item=>({...item.row,content:boundedContent(item.row.content)}));
}

export async function loadContinuityContext(client:any,userId:string,threadId:string|null,message:string,recentLimit:number):Promise<ContinuityContext|null>{
 if(!threadId||!continuityReferenceIntent(message))return null;
 const cap=Math.min(80,Math.max(recentLimit+1,recentLimit+48));
 try{
  const{data,error}=await client.from('allin_coach_messages').select('role,content,created_at').eq('user_id',userId).eq('thread_id',threadId).order('created_at',{ascending:false}).limit(cap);
  if(error)return null;
  const rows=(Array.isArray(data)?data:[]).map((row:any)=>({role:row?.role,content:String(row?.content??'').trim(),created_at:String(row?.created_at??'')})).filter((row:any):row is ContinuityRow=>(row.role==='user'||row.role==='assistant')&&Boolean(row.content)&&Boolean(row.created_at)).reverse();
  const anchors=selectContinuityAnchors(rows,message,recentLimit,4);if(!anchors.length)return null;
  return{authority:'conversation_only',guardrail:'These are bounded older messages from this exact Coach thread. They may help resolve an explicit conversational reference, but they are not canonical app state, settled fact authority, durable learning, or proof that any save/action occurred.',anchors};
 }catch{return null;}
}

function boundedContent(value:string){const clean=value.replace(/\s+/g,' ').trim();return clean.length<=MAX_ANCHOR_CHARS?clean:`${clean.slice(0,MAX_ANCHOR_CHARS-1)}…`;}
