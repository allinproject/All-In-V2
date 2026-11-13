/**
 * ALL-251 REVIEW ONLY — service-only Supabase Auth and approved request
 * binding for the EXISTING account-export worker. No deployed endpoint.
 *
 * Auth getUser verifies the supplied bearer token. Session ID is read only
 * from that verified JWT and checked in auth.sessions by the owning private
 * function. A public-schema, service-only, DEFAULT-OFF wrapper delegates
 * to the private owner+session+durable-request gate. Never expose the private
 * schema or grant worker RPC to anon/authenticated roles.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function tokenSessionId(token) {
  if(typeof token!=='string'||token.length>4096||token.length<24)return null;
  const bits=token.split('.');
  if(bits.length!==3||!bits.every(x=>x.length>0))return null;
  try {
    const payload=bits[1].replace(/-/g,'+').replace(/_/g,'/');
    const json=JSON.parse(atob(payload.padEnd(Math.ceil(payload.length/4)*4,'=')));
    return UUID.test(json?.session_id??'')?json.session_id:null;
  }catch{return null;}
}
export function createTrainingExportAuthServices({
 bearerToken,authClient,serverClient,storageAdapter,archiveSink,
}) {
 if(typeof authClient?.auth?.getUser!=='function'
   ||typeof serverClient?.rpc!=='function'
   ||typeof storageAdapter?.listEvidence!=='function'
   ||typeof storageAdapter?.downloadPrivateObject!=='function'
   ||typeof archiveSink?.writeEncryptedArchive!=='function'
   ||typeof archiveSink?.deleteStagedArchive!=='function') {
   throw new Error('Trusted account export dependencies missing');
 }
 const sessionId=tokenSessionId(bearerToken);
 if(!sessionId)throw new Error('Verified session claim required');
 async function authorizeExport(requestId) {
   if(!UUID.test(requestId??''))throw new Error('Exact export request required');
   // Never cache getUser or DB authorization. A deleted owner or revoked
   // session/request must interrupt retrieval and post-write acceptance.
   const userResult=await authClient.auth.getUser(bearerToken);
   const ownerId=userResult?.data?.user?.id;
   if(userResult?.error||!UUID.test(ownerId??'')) {
     throw new Error('Current Auth user unavailable');
   }
   const {data:gate,error}=await serverClient.rpc(
     'v2_account_export_worker_authorize_candidate',{
      p_user_id:ownerId,p_session_id:sessionId,p_request_id:requestId,
     }
   );
   if(error||gate?.ownerId!==ownerId||gate?.sessionId!==sessionId
      ||gate?.requestId!==requestId||gate?.status!=='approved'
      ||gate?.cancelled!==false||typeof gate?.expiresAt!=='string'
      ||!Number.isFinite(Date.parse(gate.expiresAt))
      ||Date.parse(gate.expiresAt)<=Date.now()
      ||Date.parse(gate.expiresAt)>Date.now()+24*60*60*1000) {
     throw new Error('Current Auth session and approved export request required');
   }
   return {ownerId,sessionId,activeSession:true,exportPermitted:true};
 }
 return Object.freeze({
   authorizeExport,
   listEvidence:storageAdapter.listEvidence,
   downloadPrivateObject:storageAdapter.downloadPrivateObject,
   writeEncryptedArchive:archiveSink.writeEncryptedArchive,
   deleteStagedArchive:archiveSink.deleteStagedArchive,
 });
}
