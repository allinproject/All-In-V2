/**
 * ALL-251 source-only owner JWT transport for existing HMAC attestation.
 * NEVER uses a privileged Supabase key. The database's SECURITY DEFINER
 * wrappers enforce auth.uid()==signed owner and real Auth session.
 * The private signing key remains only in the trusted Worker and DB.
 */
const ORIGIN='https://fbtgknlxjyeqrxemskbl.supabase.co';
const NAMES=Object.freeze({
 v2_begin_privileged_storage_write_attested_review:{
  endpoint:'v2_all251_owner_attested_begin_review',
  keys:new Set(['p_owner_id','p_bucket_id','p_object_path','p_operation',
   'p_sha256','p_nonce','p_issued_epoch','p_signature']),
 },
 v2_settle_privileged_storage_write_attested_review:{
  endpoint:'v2_all251_owner_attested_settle_review',
  keys:new Set(['p_owner_id','p_lease_id','p_nonce','p_issued_epoch',
   'p_signature']),
 },
});
export function createAll251OwnerJwtAttestedRpcReview({
 env,accessToken,fetchImpl=fetch,
}){
 if(env?.SUPABASE_URL!==ORIGIN||
  !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env?.SUPABASE_PUBLISHABLE_KEY??'')||
  !/^[A-Za-z0-9._~-]{20,4096}$/.test(accessToken??'')||
  typeof fetchImpl!=='function')
  throw Error('OWNER_JWT_ATTESTATION_NOT_CONFIGURED');
 return Object.freeze({
  async rpc(name,args){
   const route=Object.hasOwn(NAMES,name)?NAMES[name]:null;
   if(!route||!args||typeof args!=='object'||Array.isArray(args)||
      Object.keys(args).length!==route.keys.size||
      Object.keys(args).some(k=>!route.keys.has(k)))
    return {data:null,error:{code:'ATTESTED_SCOPE_DENIED'}};
   try{
    const result=await fetchImpl(ORIGIN+'/rest/v1/rpc/'+route.endpoint,{
     method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
     headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,
      authorization:'Bearer '+accessToken,
      'content-type':'application/json',accept:'application/json'},
     body:JSON.stringify(args),
    });
    if(result.status!==200||result.redirected)
     return {data:null,error:{code:'ATTESTED_UNVERIFIED'}};
    const data=await result.json();
    if(name.startsWith('v2_begin_')){
     if(typeof data!=='string'||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data))
      return {data:null,error:{code:'ATTESTED_UNVERIFIED'}};
    }else if(data!==true){
     return {data:null,error:{code:'ATTESTED_UNVERIFIED'}};
    }
    return {data,error:null};
   }catch{return {data:null,error:{code:'ATTESTED_UNVERIFIED'}};}
  },
 });
}
