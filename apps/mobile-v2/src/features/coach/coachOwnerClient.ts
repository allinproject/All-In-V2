import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types.ts';
/** ALL-217 canonical Coach endpoint; no shadow transcript or model in mobile. */
export const V2_COACH_READ_ENABLED=process.env.EXPO_PUBLIC_V2_COACH_READ_ENABLED==='true';
export const V2_COACH_SEND_ENABLED=process.env.EXPO_PUBLIC_V2_COACH_SEND_ENABLED==='true';
const uuid=(x:unknown):x is string=>typeof x==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const unavailable=()=>({status:'unavailable' as const});
export type CoachMessage={id:string;threadId:string;role:'user'|'assistant';content:string;createdAt:string};
export type CoachSendCommand={threadId:string;clientRequestId:string;
 userMessageId:string;assistantMessageId:string;message:string};
export type CoachServices={
 session:()=>Promise<{ownerId:string;token:string}|null>;
 request:(body:Record<string,unknown>)=>Promise<unknown>
};
export function createCoachOwnerClient(deps:CoachServices,ownerId:string,
 current:()=>boolean=()=>true,readEnabled=V2_COACH_READ_ENABLED,
 sendEnabled=V2_COACH_SEND_ENABLED){
 let token:string|null=null;
 const owner=async()=>{
  if(!uuid(ownerId)||!current())return false;
  const next=await deps.session();
  if(!current()||next?.ownerId!==ownerId||!next.token||
    (token!==null&&token!==next.token))return false;
  token=next.token;return true;
 };
 const call=async(payload:Record<string,unknown>):Promise<Record<string,unknown>|null>=>{
  if(!await owner())return null;
  try{
   const r=await deps.request({ownerId,...payload});
   return await owner()&&obj(r)&&r.status==='ok'?r:null;
  }catch{return null}
 };
 return {
  open:async(candidateThreadId:string)=>{
   if(!readEnabled||!uuid(candidateThreadId))return unavailable();
   const r=await call({action:'open',candidateThreadId});
   return uuid(r?.threadId)?{status:'ready' as const,threadId:r.threadId}:unavailable();
  },
  history:async(threadId:string)=>{
   if(!readEnabled||!uuid(threadId))return unavailable();
   const r=await call({action:'history',threadId,limit:40});
   if(!r||!Array.isArray(r.messages)||r.messages.length>40||
      typeof r.hasMore!=='boolean')return unavailable();
   const messages:CoachMessage[]=[];
   const ids=new Set<string>();
   for(const m of r.messages){
    if(!obj(m)||!uuid(m.id)||m.threadId!==threadId||
      !['user','assistant'].includes(String(m.role))||
      typeof m.content!=='string'||!m.content.trim()||m.content.length>20000||
      typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||
      ids.has(m.id))return unavailable();
    ids.add(m.id);messages.push({id:m.id,threadId,role:m.role as CoachMessage['role'],
      content:m.content,createdAt:m.createdAt});
   }
   return {status:'ready' as const,messages,hasMore:r.hasMore};
  },
  send:async(command:CoachSendCommand)=>{
   if(!readEnabled||!sendEnabled||!command||
      ![command.threadId,command.clientRequestId,command.userMessageId,
        command.assistantMessageId].every(uuid)||
      new Set([command.clientRequestId,command.userMessageId,command.assistantMessageId]).size!==3||
      typeof command.message!=='string'||!command.message.trim()||
      command.message.length>12000)return unavailable();
   const r=await call({action:'send',...command});
   if(!r||typeof r.message!=='string'||!r.message.trim()||
     r.message.length>20000||!obj(r.receipt))return unavailable();
   const p=r.receipt;
   if(p.ownerId!==ownerId||p.threadId!==command.threadId||
      p.clientRequestId!==command.clientRequestId||
      p.userMessageId!==command.userMessageId||
      p.assistantMessageId!==command.assistantMessageId)return unavailable();
   return {status:'saved' as const,message:r.message,
     receipt:{ownerId,threadId:command.threadId,clientRequestId:command.clientRequestId,
      userMessageId:command.userMessageId,assistantMessageId:command.assistantMessageId},
     replayed:r.replayed===true};
  }
 };
}
export function coachServicesForSupabase(client:SupabaseClient<Database>):CoachServices{
 return {
  session:async()=>{
   const {data,error}=await client.auth.getSession();
   if(error||!data.session)return null;
   const token=data.session.access_token;
   const verified=await client.auth.getUser(token);
   return verified.error||verified.data.user?.id!==data.session.user.id
     ?null:{ownerId:data.session.user.id,token};
  },
  request:async body=>{
   const {data,error}=await client.functions.invoke('v2-coach',{body});
   return error?null:data;
  }
 };
}
