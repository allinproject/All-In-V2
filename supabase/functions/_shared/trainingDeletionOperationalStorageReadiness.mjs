/**
 * ALL-251 — server-only operational Storage readiness readback.
 * This does NOT perform cleanup and does NOT turn a review receipt into an
 * Auth deletion authorization. The future authoritative DB RPC must certify
 * completed private Storage cleanup AND an enforced upload barrier covering
 * every authenticated and privileged writer for this exact deletion request.
 *
 * The RPC is intentionally unavailable until that durable contract has been
 * approved and deployed. Missing RPC, absent row or errors fail closed.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_FULL=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_KEYS=['ownerId','requestId','completePrivateStorage','durableCheckpointVerified','uploadBarrierEnforced'];
export function createOperationalStorageReadiness({supabase}) {
 if(!supabase || typeof supabase.rpc!=='function')
  throw Error('Server service-role database client required');
 return Object.freeze({
  async verifyStorageReadiness({user_id,request_id}) {
   if(!UUID_FULL.test(user_id??'') || !UUID_FULL.test(request_id??''))
    throw Error('Exact deletion owner and request required');
   const {data,error}=await supabase.rpc('v2_verify_account_deletion_storage_readiness',{
    p_expected_user_id:user_id,p_expected_request_id:request_id,
   });
   if(error||!data||Array.isArray(data)||typeof data!=='object')
    throw Error('Authoritative Storage readiness not available');
   if(Object.keys(data).sort().join('|')!==[...EXPECTED_KEYS].sort().join('|') ||
     data.ownerId!==user_id||data.requestId!==request_id ||
     data.completePrivateStorage!==true ||
     data.durableCheckpointVerified!==true ||
     data.uploadBarrierEnforced!==true)
    throw Error('Durable Storage readiness incomplete');
   return Object.freeze({...data});
  },
 });
}
