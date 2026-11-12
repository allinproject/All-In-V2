// ALL-243 STAGED and DEFAULT OFF. Client may request a challenge or revoke
// its OWN device, but can NEVER certify itself. Completion requires INTERNAL
// signed evidence produced by a separately approved native/provider verifier.
// Apple Watch/HealthKit do not issue generic signed webhooks; no such verifier
// is enabled by this Edge Function or by setting the feature gate alone.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import postgres from 'npm:postgres@3.4.7';
import {
 issueDevicePairingChallenge,completeVerifiedDevicePairing,revokeOwnedDevice,
 type ServerVerifiedDeviceProof,
} from '../_shared/certifiedDevicePairingServer.ts';
import {createDevicePairingPostgresBackend} from
 '../_shared/certifiedDevicePairingPostgres.ts';
import type {TransactionalSql} from '../_shared/certifiedDevicePostgresAdapter.ts';

const reply=(status:number,code:string)=>
 new Response(JSON.stringify({code}),{status,headers:{
  'content-type':'application/json','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
 }});
const uuid=(s:unknown)=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function claimsFromAuthVerifiedJwt(token:string){
 // Never parse this until Supabase Auth.getUser has verified the bearer.
 try{
  const segments=token.split('.');
  if(segments.length!==3)return null;
  const payload=segments[1].replace(/-/g,'+').replace(/_/g,'/');
  const data=JSON.parse(atob(payload.padEnd(Math.ceil(payload.length/4)*4,'=')));
  if(!uuid(data?.session_id)||!Number.isSafeInteger(data.exp))return null;
  return {sessionId:data.session_id,expiresAtMs:data.exp*1000};
 }catch{return null;}
}
async function jsonUnder(req:Request,max:number){
 const len=Number(req.headers.get('content-length')??0);
 if(!Number.isSafeInteger(len)||len<0||len>max)return null;
 const stream=req.body?.getReader();if(!stream)return null;
 const chunks:Uint8Array[]=[];let count=0;
 try{
  while(true){
   const {done,value}=await stream.read();if(done)break;
   if(!value)continue;count+=value.length;
   if(count>max){await stream.cancel();return null;}chunks.push(value);
  }
  const bytes=new Uint8Array(count);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{return null;}
}
Deno.serve(async(req)=>{
 if(Deno.env.get('ALLIN_V2_DEVICE_PAIRING_ARMED')!=='true')
  return reply(503,'device_pairing_disabled');
 if(req.method!=='POST')return reply(405,'method_not_allowed');
 const authorization=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(authorization)||
    authorization.length>8192)return reply(401,'unauthorized');
 const url=Deno.env.get('SUPABASE_URL')??'';
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 const registrarUrl=Deno.env.get('ALLIN_V2_PAIRING_DATABASE_URL')??'';
 const internalSecret=Deno.env.get('ALLIN_V2_TRUSTED_PAIRING_PROOF_KEY')??'';
 if(!url||!serviceKey||!/^postgres(ql)?:\/\//.test(registrarUrl)||
    internalSecret.length<32)return reply(503,'device_pairing_unconfigured');
 const payload=await jsonUnder(req,8*1024);
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  return reply(400,'invalid_pairing_request');
 const args=payload as Record<string,unknown>;
 if(!['challenge','pair','revoke'].includes(String(args.action)))
  return reply(400,'invalid_pairing_action');
 // 'pair' is cryptographically denied unless a separate provider verifier
 // signed exact owner/session/challenge/device/evidence with the private key.
 // There is NO public signing endpoint and NO client "certified" flag.
 const db=postgres(registrarUrl,{max:1,prepare:false,connect_timeout:5,idle_timeout:5});
 try{
  const auth=createClient(url,serviceKey,{auth:{
   persistSession:false,autoRefreshToken:false,
  }});
  const backend=createDevicePairingPostgresBackend({
   db:db as unknown as TransactionalSql,
   auth:{getUser:async token=>{
    const {data,error}=await auth.auth.getUser(token);
    return error||!uuid(data?.user?.id)?null:{id:data.user.id};
   }},
   readVerifiedTokenClaims:claimsFromAuthVerifiedJwt,nowMs:()=>Date.now(),
  });
  const token=authorization.slice(7),now=Date.now();
  if(args.action==='challenge'){
   const result=await issueDevicePairingChallenge(token,{
    provider:String(args.provider??''),deviceRef:String(args.deviceRef??''),
   },backend,now);
   return new Response(JSON.stringify(result),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  if(args.action==='revoke'){
   const result=await revokeOwnedDevice(token,String(args.deviceId??''),backend,now);
   return new Response(JSON.stringify(result),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  }
  // The payload is NOT a certification: the HMAC is independently checked
  // against an internal secret unavailable to clients or the native app.
  const proof=args.proof as ServerVerifiedDeviceProof;
  const result=await completeVerifiedDevicePairing(token,proof,
   backend,internalSecret,now);
  return new Response(JSON.stringify(result),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }});
 }catch{
  // Never disclose device ownership or whether a session/source exists.
  return reply(403,'pairing_denied');
 }finally{await db.end({timeout:3}).catch(()=>{});}
});
