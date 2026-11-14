/**
 * ALL-251 REVIEW ONLY. Authenticates an active session through the
 * pre-existing canonical private session+deletion check, exposed ONLY by
 * an approved narrow staging RPC. Does not grant a Storage operation.
 * No service_role secret or signer material is held by this module.
 */
const ORIGIN='https://fbtgknlxjyeqrxemskbl.supabase.co';
const ENDPOINT=ORIGIN+'/rest/v1/rpc/v2_all251_worker_session_check_review';
export function createAll251SessionAuthority({env,fetchImpl=fetch}){
 if(env?.SUPABASE_URL!==ORIGIN||
    typeof env?.SUPABASE_PUBLISHABLE_KEY!=='string'||
    !env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')||
    typeof fetchImpl!=='function')
  throw Error('SESSION_AUTHORITY_NOT_CONFIGURED');
 return async function sessionIsActive({ownerId,accessToken}){
  // Identity is already verified separately through Auth /user.
  // Never pass an owner identifier as a client-controlled RPC parameter.
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId??'')||
    typeof accessToken!=='string'||
    !/^[A-Za-z0-9._~-]{20,4096}$/.test(accessToken))
   return false;
  let response;
  try{
   response=await fetchImpl(ENDPOINT,{
    method:'POST',
    redirect:'manual',
    signal:AbortSignal.timeout(8000),
    headers:{
     apikey:env.SUPABASE_PUBLISHABLE_KEY,
     authorization:'Bearer '+accessToken,
     'content-type':'application/json',
     accept:'application/json',
    },
    body:'{}',
   });
  }catch{return false;}
  // 200 true is the ONLY affirmative response. 401/403/404, malformed,
  // stale REST cache, redirects and missing function all fail closed.
  if(response.status!==200||response.redirected)return false;
  try{
   return (await response.json())===true;
  }catch{return false;}
 };
}
