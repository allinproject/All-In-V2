/**
 * ALL-251 source-only RESTRICTED RPC adapter for the existing attestor.
 * Not referenced by the deployed default-deny Worker.
 *
 * The project secret key remains powerful even when code limits RPC names.
 * This is defense in depth, NOT a provider-enforced least-privilege token.
 * The only trusted caller is the independently controlled Cloudflare Worker,
 * never a mobile client, Supabase shared Edge runtime or public endpoint.
 */
const ORIGIN='https://fbtgknlxjyeqrxemskbl.supabase.co';
const NAMES=Object.freeze({
 v2_begin_privileged_storage_write_attested_review:new Set([
  'p_owner_id','p_bucket_id','p_object_path','p_operation','p_sha256',
  'p_nonce','p_issued_epoch','p_signature',
 ]),
 v2_settle_privileged_storage_write_attested_review:new Set([
  'p_owner_id','p_lease_id','p_nonce','p_issued_epoch','p_signature',
 ]),
});
export function createAll251AttestedRpcReview({env,fetchImpl=fetch}){
 const key=env?.ALL251_STAGING_PRIVILEGED_KEY;
 if(env?.SUPABASE_URL!==ORIGIN||
    typeof key!=='string'||!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)||
    typeof fetchImpl!=='function')
  throw Error('ATTESTED_RPC_NOT_CONFIGURED');
 return Object.freeze({
  async rpc(name,args){
   const expected=Object.hasOwn(NAMES,name)?NAMES[name]:null;
   if(!expected||!args||typeof args!=='object'||Array.isArray(args)||
      Object.keys(args).length!==expected.size||
      Object.keys(args).some(k=>!expected.has(k)))
    return {data:null,error:{code:'RPC_SCOPE_DENIED'}};
   try{
    const response=await fetchImpl(ORIGIN+'/rest/v1/rpc/'+name,{
     method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
     headers:{
      apikey:key,
      authorization:'Bearer '+key,
      'content-type':'application/json',
      accept:'application/json',
     },
     body:JSON.stringify(args),
    });
    if(response.status!==200||response.redirected)
     return {data:null,error:{code:'RPC_UNVERIFIED'}};
    const data=await response.json();
    // The caller checks the expected UUID / boolean receipt.
    if(typeof data!=='string'&&typeof data!=='boolean')
     return {data:null,error:{code:'RPC_UNVERIFIED'}};
    return {data,error:null};
   }catch{
    // No token, provider text, signature or owner exposed in errors.
    return {data:null,error:{code:'RPC_UNVERIFIED'}};
   }
  },
 });
}
