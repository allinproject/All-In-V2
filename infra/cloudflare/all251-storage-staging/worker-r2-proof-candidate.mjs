/**
 * ALL-251 STAGING-ONLY, NON-DEPLOYED R2 byte-proof candidate.
 *
 * NEVER replace worker.mjs with this module before operator-reviewed:
 * matched independent HMAC custody, protected ephemeral keys, rollback,
 * real A/B leased-write and deletion-race acceptance.
 *
 * No unauthenticated object access, no GET/download, presign, multipart,
 * arbitrary key, overwrite, operator override, or app-runtime integration.
 * Only pre-authorized *synthetic* Supabase Auth accounts may POST small bytes.
 */
import {createAll251InternalWriterReview} from './internal-writer-review.mjs';
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
    if(request.method!=='POST'||!/^\/v1\/workouts\/[0-9a-f-]{36}$/i.test(uri.pathname)||
      uri.search||request.headers.get('content-type')!=='application/octet-stream')
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
