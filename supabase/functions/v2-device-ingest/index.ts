// ALL-243 STAGED ONLY. This server-to-server endpoint is DEFAULT OFF.
// It is NOT a native device certification endpoint. The caller MUST be an
// independently authenticated, server-side provider adapter that signs the
// INTERNAL HMAC envelope. HealthKit/Watch do not issue generic webhooks.
// Never deploy/arm until DB operator credentials, role membership, RLS,
// device-registration writer and real device acceptance have been approved.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import postgres from 'npm:postgres@3.4.7';
import {ingestVerifiedDeviceEnvelopeTransactional,
 type DeviceIngestEnvelope} from '../_shared/certifiedDeviceIngestServer.ts';
import {createCertifiedDevicePostgresAdapter} from
 '../_shared/certifiedDevicePostgresAdapter.ts';

const reply=(status:number,code:string)=>
 new Response(JSON.stringify({code}),{status,headers:{
  'content-type':'application/json','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
 }});
const uuid=(s:unknown)=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function verifiedClaims(token:string){
 // Only invoked AFTER Supabase Auth.getUser verified this exact bearer.
 // Decoding alone never verifies the identity or signature.
 try{
  const parts=token.split('.');
  if(parts.length!==3)return null;
  const p=parts[1].replace(/-/g,'+').replace(/_/g,'/');
  const claims=JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'=')));
  if(!uuid(claims?.session_id)||!Number.isSafeInteger(claims.exp))return null;
  return {sessionId:claims.session_id,expiresAtMs:claims.exp*1000};
 }catch{return null;}
}
async function readJsonBounded(req:Request,max:number){
 const length=Number(req.headers.get('content-length')??0);
 if(!Number.isSafeInteger(length)||length<0||length>max)return null;
 const reader=req.body?.getReader();if(!reader)return null;
 let size=0;const parts:Uint8Array[]=[];
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   if(!value)continue;size+=value.length;
   if(size>max){await reader.cancel();return null;}parts.push(value);
  }
  const data=new Uint8Array(size);let i=0;
  for(const part of parts){data.set(part,i);i+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
 }catch{return null;}
}
Deno.serve(async req=>{
 // No keys, source IDs, tokens or raw device facts in responses/logs.
 if(Deno.env.get('ALLIN_V2_DEVICE_INGEST_ARMED')!=='true')
  return reply(503,'device_ingest_disabled');
 if(req.method!=='POST')return reply(405,'method_not_allowed');
 const authorization=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(authorization)||
    authorization.length>8192)return reply(401,'unauthorized');
 const bearer=authorization.slice(7);
 const dbUrl=Deno.env.get('ALLIN_V2_INGEST_DATABASE_URL')??'';
 const supabaseUrl=Deno.env.get('SUPABASE_URL')??'';
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 const secret=Deno.env.get('ALLIN_V2_DEVICE_INTERNAL_HMAC_SECRET')??'';
 if(!dbUrl.startsWith('postgres://')&&!dbUrl.startsWith('postgresql://'))
  return reply(503,'device_ingest_unconfigured');
 if(!supabaseUrl||!serviceKey||secret.length<32)
  return reply(503,'device_ingest_unconfigured');
 const packet=await readJsonBounded(req,64*1024);
 if(!packet||typeof packet!=='object'||Array.isArray(packet))
  return reply(400,'invalid_device_packet');
 const envelope=packet as DeviceIngestEnvelope;
 if(!envelope.payload||typeof envelope.nonce!=='string'||
   typeof envelope.signatureHex!=='string')
  return reply(400,'invalid_device_packet');

 // Bounded one-request/one-transaction connection. No SQL logs or
 // privileged DB credentials ever flow to the calling client.
 const sql=postgres(dbUrl,{max:1,prepare:false,connect_timeout:5,
  idle_timeout:5});
 try{
  const supabase=createClient(supabaseUrl,serviceKey,{
   auth:{persistSession:false,autoRefreshToken:false},
  });
  const backend=createCertifiedDevicePostgresAdapter({
   db:sql,
   auth:{getUser:async token=>{
    const {data,error}=await supabase.auth.getUser(token);
    return error||!uuid(data?.user?.id)?null:{id:data.user.id};
   }},
   readVerifiedTokenClaims:verifiedClaims,nowMs:()=>Date.now(),
  });
  const result=await ingestVerifiedDeviceEnvelopeTransactional(
   envelope,backend,bearer,secret,Date.now());
  return new Response(JSON.stringify({status:result.status,
   activityId:result.activityId}),{status:result.status==='review_required'?202:200,
   headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{
  // Client never learns owner existence, session ID or source existence.
  return reply(403,'device_ingest_unavailable');
 }finally{await sql.end({timeout:3}).catch(()=>{});}
});
