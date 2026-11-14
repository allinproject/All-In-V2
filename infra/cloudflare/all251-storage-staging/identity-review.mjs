/**
 * ALL-251 REVIEW ONLY identity guard. Not connected to public routes.
 * Never derive identity from request body, path owner, user_metadata or
 * unverified JWT claims. Supabase Auth verifies token; separate session
 * authority must confirm the session still exists and is active.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const expectedOrigin='https://fbtgknlxjyeqrxemskbl.supabase.co';
export async function verifyAll251OwnerSession({
 request,env,sessionIsActive,fetchImpl=fetch,
}){
 const authorization=request?.headers?.get('authorization')??'';
 // Reject duplicate schemes, whitespace, unexpected credentials and huge
 // tokens; do not copy auth values into logs or returned errors.
 if(!/^Bearer [A-Za-z0-9._~-]{20,4096}$/.test(authorization))
  throw Error('AUTH_DENIED');
 if(env?.SUPABASE_URL!==expectedOrigin||
  typeof env?.SUPABASE_PUBLISHABLE_KEY!=='string'||
  !env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')||
  typeof sessionIsActive!=='function')
  throw Error('AUTH_NOT_CONFIGURED');
 const token=authorization.slice(7);
 let response;
 try{
  response=await fetchImpl(expectedOrigin+'/auth/v1/user',{
   method:'GET',
   redirect:'manual',
   signal:AbortSignal.timeout(8000),
   headers:{
    apikey:env.SUPABASE_PUBLISHABLE_KEY,
    authorization:'Bearer '+token,
    accept:'application/json',
   },
  });
 }catch{throw Error('AUTH_DENIED');}
 if(response.status!==200||response.redirected)throw Error('AUTH_DENIED');
 let user;
 try{user=await response.json();}catch{throw Error('AUTH_DENIED');}
 if(!UUID.test(user?.id??'')||user?.is_anonymous===true)
  throw Error('AUTH_DENIED');
 // This is a validated subject but NOT an authorized upload. A separate
 // server-owned active-session source is mandatory; a self-reported
 // JWT session_id or client-supplied owner ID is never sufficient.
 const active=await sessionIsActive({ownerId:user.id,accessToken:token});
 if(active!==true)throw Error('AUTH_DENIED');
 return Object.freeze({verifiedOwnerId:user.id});
}
export function requireOwnedPrivatePath(ownerId,path){
 if(!UUID.test(ownerId??'')||typeof path!=='string'||path.length>1024||
  !path.startsWith(ownerId+'/')||path.split('/').some(segment=>
   !segment||segment==='.'||segment==='..'||/[\\\u0000-\u001f]/.test(segment)))
  throw Error('OWNER_PATH_DENIED');
 return path;
}
