/**
 * ALL-251 STAGING-ONLY, NON-DEPLOYED R2 byte-proof candidate.
 *
 * NEVER replace worker.mjs with this module before operator-reviewed:
 * matched independent HMAC custody, protected ephemeral keys, rollback,
 * real A/B leased-write and deletion-race acceptance.
 *
 * No unauthenticated object access, no raw-byte GET/download, presign,
 * multipart, arbitrary key, overwrite, or app-runtime integration.
 * Only pre-authorized synthetic Auth owners may POST small bytes. Their
 * pending-deletion fixtures may be deleted only when zero leases are open.
 */
import {createAll251InternalWriterReview} from './internal-writer-review.mjs';
import {verifyAll251OwnerSession} from './identity-review.mjs';
import {createAll251UploadIngressReview} from './upload-ingress-review.mjs';
import {createAll251OwnerJwtAttestedRpcReview} from './owner-jwt-attested-rpc-review.mjs';
import {createAttestedPrivilegedStorageLeaseAuthority}
 from '../../../supabase/functions/_shared/trainingPrivilegedStorageWriterAttestor.mjs';

const EXPECTED='https://fbtgknlxjyeqrxemskbl.supabase.co';
const SWITCH='synthetic-proof-reviewed';
const RESTRICTED=/^all251-http-[a-z0-9-]+@example\.invalid$/i;
const deny=(code='STORAGE_NOT_READY')=>new Response(
 JSON.stringify({code}),{status:403,headers:{
  'content-type':'application/json',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
 }});
function signerBytes(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))
  throw Error('SIGNER_UNAVAILABLE');
 const raw=atob(value);
 if(raw.length!==32)throw Error('SIGNER_UNAVAILABLE');
 const bytes=Uint8Array.from(raw,x=>x.charCodeAt(0));
 if(btoa(String.fromCharCode(...bytes))!==value)
  throw Error('SIGNER_UNAVAILABLE');
 return bytes;
}
export function createAll251R2ProofCandidate({
 fetchImpl=fetch,
 createAuthority=createAttestedPrivilegedStorageLeaseAuthority,
 createRPC=createAll251OwnerJwtAttestedRpcReview,
 createWriter=createAll251InternalWriterReview,
}={}){
 return {
  async fetch(request,env){
   // This gate is NOT a substitute for external deployment protections.
   // It only prevents accidental activation of review source.
   if(env?.ALL251_ENABLE_SYNTHETIC_PROOF!==SWITCH||
      env?.SUPABASE_URL!==EXPECTED||
      !env?.PRIVATE_STORAGE)
    return deny();
   try{
    const uri=new URL(request.url);
    const writing=request.method==='POST'&&
     /^\/v1\/workouts\/[0-9a-f-]{36}$/i.test(uri.pathname);
    const reading=request.method==='GET'&&
     /^\/v1\/workouts\/[0-9a-f-]{36}\/checksum$/i.test(uri.pathname);
    const deleting=request.method==='DELETE'&&
     /^\/v1\/workouts\/[0-9a-f-]{36}$/i.test(uri.pathname);
    if((!writing&&!reading&&!deleting)||uri.search||
       (writing&&request.headers.get('content-type')!=='application/octet-stream'))
     return deny('ROUTE_DENIED');
    const bearer=request.headers.get('authorization')??'';
    if(!/^Bearer [A-Za-z0-9._~-]{20,4096}$/.test(bearer))
     return deny('AUTH_DENIED');
    // Synthetic-only restriction must use actual Auth /user response, not
    // request headers, user_metadata or unverified JWT claims.
    const res=await fetchImpl(EXPECTED+'/auth/v1/user',{
     method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000),
     headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,
      authorization:bearer,accept:'application/json'},
    });
    if(res.status!==200||res.redirected)return deny('AUTH_DENIED');
    const profile=await res.json();
    if(profile?.app_metadata?.all251_httpmatrix!==true||
       typeof profile?.email!=='string'||!RESTRICTED.test(profile.email))
     return deny('SYNTHETIC_ONLY');
    if(deleting){
     if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profile?.id??'')||
        typeof env.PRIVATE_STORAGE.delete!=='function'||
        typeof env.PRIVATE_STORAGE.head!=='function')
      return deny('CLEANUP_NOT_READY');
     // Recheck the server-owned pending deletion freeze + zero open leases.
     // Ordinary active sessions and normal accounts CANNOT delete objects.
     const authorized=await fetchImpl(EXPECTED+
       '/rest/v1/rpc/v2_all251_owner_r2_fixture_cleanup_allowed_review',{
       method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
       headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,
        authorization:bearer,'content-type':'application/json',
        accept:'application/json'},
       body:'{}',
     });
     if(authorized.status!==200||authorized.redirected||
        (await authorized.json())!==true)return deny('CLEANUP_DENIED');
     const objectId=uri.pathname.split('/')[3].toLowerCase();
     const path=profile.id+'/'+objectId+'.bin';
     await env.PRIVATE_STORAGE.delete(path);
     if(await env.PRIVATE_STORAGE.head(path)!==null)
      return deny('CLEANUP_UNVERIFIED');
     return new Response(null,{status:204,headers:{
       'cache-control':'no-store','x-content-type-options':'nosniff'},
     });
    }
    if(reading){
     const id=uri.pathname.split('/')[3].toLowerCase();
     const {verifiedOwnerId}=await verifyAll251OwnerSession({
      request,env,fetchImpl,
      sessionIsActive:async({accessToken})=>{
       const check=await fetchImpl(EXPECTED+
        '/rest/v1/rpc/v2_all251_worker_session_check_review',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
        headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,
         authorization:'Bearer '+accessToken,
         'content-type':'application/json',accept:'application/json'},
        body:'{}',
       });
       return check.status===200&&(await check.json())===true;
      },
     });
     const object=await env.PRIVATE_STORAGE.get(verifiedOwnerId+'/'+id+'.bin');
     if(!object)return deny('OBJECT_NOT_FOUND');
     const bytes=await object.arrayBuffer();
     const digest=Array.from(new Uint8Array(
       await crypto.subtle.digest('SHA-256',bytes)),
       x=>x.toString(16).padStart(2,'0')).join('');
     return new Response(JSON.stringify({sha256:digest,length:bytes.byteLength}),{
      status:200,headers:{'content-type':'application/json',
       'cache-control':'no-store','x-content-type-options':'nosniff'},
     });
    }
    // Separate session/deletion-state RPC is checked again by canonical
    // internal writer *before* reading any request bytes.
    const signing=signerBytes(env.ALL251_WRITER_SIGNER_B64);
    const rpc=createRPC({env,fetchImpl,accessToken:bearer.slice(7)});
    const authority=createAuthority({supabase:rpc,signingKey:signing});
    signing.fill(0);
    const writer=createWriter({
     env,fetchImpl,binding:env.PRIVATE_STORAGE,
     attestedLeaseAuthority:authority,
    });
    return await createAll251UploadIngressReview({internalWriter:writer})(request);
   }catch{
    // Never leak key / token / user ID / provider error to public caller.
    return deny();
   }
  },
 };
}
export default createAll251R2ProofCandidate();
