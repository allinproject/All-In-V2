// ALL-252 — STAGED READ-ONLY entitlement endpoint, DEFAULT OFF.
// No purchase actions, Stripe tokens, checkout, event rows or raw customer data.
// Authenticated owner is verified with Supabase Auth, not request parameters.
// Do not deploy/arm before ALL-222 ledger grants and installed-device acceptance.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const headers={
  "content-type":"application/json",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
};
const uuid=(v:unknown):v is string=>typeof v==="string"&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function reply(status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{status,headers});
}
Deno.serve(async(req:Request)=>{
  if(Deno.env.get("ALLIN_BILLING_ENTITLEMENT_ARMED")!=="true")
    return reply(503,{code:"entitlement_disabled"});
  if(req.method!=="GET")return reply(405,{code:"method_not_allowed"});
  const auth=req.headers.get("authorization")??"";
  if(!/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(auth)||auth.length>4096)
    return reply(401,{code:"unauthorized"});
  const serviceUrl=Deno.env.get("SUPABASE_URL");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceUrl||!serviceKey)return reply(503,{code:"entitlement_disabled"});
  const client=createClient(serviceUrl,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data:userData,error:authError}=await client.auth.getUser(auth.slice(7));
  const owner=userData?.user?.id;
  if(authError||!uuid(owner))return reply(401,{code:"unauthorized"});
  // Environment is trusted configuration, NEVER a user-supplied query param.
  const {data,error}=await client.rpc("v2_billing_read_owner_access",{
    p_owner_id:owner,p_environment:"sandbox",
  });
  if(error||!Array.isArray(data)||data.length!==1||
     typeof data[0]?.entitled!=="boolean"||
     (data[0].entitled&&typeof data[0].access_until!=="string")||
     (!data[0].entitled&&data[0].access_until!=null))
    return reply(503,{code:"entitlement_unavailable"});
  return reply(200,{
    entitled:data[0].entitled,
    accessUntil:data[0].entitled?data[0].access_until:null,
  });
});
