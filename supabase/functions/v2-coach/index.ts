// ALL-217 — staged V2 Coach owner transport. DEFAULT OFF and read-only.
// Not approved for deployment or model usage; this extends the canonical
// ALL-217 thread/message RPCs without creating a second conversation store.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.118.0";
import {createCoachSupabaseDependencies} from "../_shared/coachSupabasePersistence.mjs";
import {handleCoachRuntimeRequest} from "../_shared/coachRuntimeIngress.mjs";

const disabled=()=>new Response(JSON.stringify({code:"coach_disabled"}),{
 status:503,headers:{"content-type":"application/json",
 "cache-control":"no-store","x-content-type-options":"nosniff"}
});
Deno.serve(async(req:Request)=>{
  // Intentional two-stage release gate: a deploy alone cannot activate Coach.
  // Real model requests are denied even if read-only owner history is enabled.
  if(Deno.env.get("ALLIN_V2_COACH_READ_ARMED")!=="true")return disabled();
  const auth=req.headers.get("authorization")??"";
  const m=/^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/.exec(auth);
  if(!m||auth.length>8192)return new Response(
    JSON.stringify({code:"unauthorized"}),{status:401,headers:{
     "content-type":"application/json","cache-control":"no-store"
    }}
  );
  const url=Deno.env.get("SUPABASE_URL")??"";
  const anon=Deno.env.get("SUPABASE_ANON_KEY")??"";
  if(!url||!anon)return disabled();
  // Only an authenticated owner JWT is sent to owner-read RPCs.
  // Never put privileged credentials, a model key or V1 runtime into mobile.
  const userClient=createClient(url,anon,{
    global:{headers:{Authorization:auth}},
    auth:{persistSession:false,autoRefreshToken:false}
  });
  // The canonical owner read adapter has no permission to execute a model.
  // This inert server-only dependency satisfies the shared interface without
  // introducing any service key into the read-only release candidate.
  const noPrivilegedWriter={
    rpc:async()=>{throw new Error("coach_provider_not_armed")}
  };
  const deps=createCoachSupabaseDependencies({
    userClient,serverClient:noPrivilegedWriter,bearerToken:m[1],
    providerGenerate:async()=>{throw new Error("coach_provider_not_armed")}
  });
  return handleCoachRuntimeRequest(req,{
    verifyUser:deps.verifyUser,
    createOrResumeThread:deps.createOrResumeThread,
    readTranscriptPage:deps.readTranscriptPage,
    // Sending remains unavailable until server-only provider controls,
    // authenticated canonical context, and spend policy are accepted.
    executeExchange:async()=>({status:"blocked",reason:"coach_provider_not_armed"})
  },{enabled:true});
});
