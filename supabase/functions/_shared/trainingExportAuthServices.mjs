/**
 * ALL-251 REVIEW ONLY — server-only authorization binding for the EXISTING
 * account export worker, not a public API or new source of truth.
 *
 * authClient.auth.getUser() validates the Bearer token with Supabase Auth.
 * The session ID is read from that verified token, then checked against live
 * auth.sessions by the private SQL candidate (not client-editable metadata).
 * Existing ALL-251 owner workflow must supply authorizeDurableRequest to
 * prove request ownership, active status and finite expiry; NO fallback.
 * No service keys / JWTs / storage URLs are returned to the mobile client.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tokenSessionId(token) {
  if(typeof token!=='string'||token.length>4096||token.length<24)return null;
  const bits=token.split('.');
  if(bits.length!==3||!bits.every(x=>x.length>0))return null;
  try {
    const payload=bits[1].replace(/-/g,'+').replace(/_/g,'/');
    const json=JSON.parse(atob(payload.padEnd(Math.ceil(payload.length/4)*4,'=')));
    return UUID.test(json?.session_id??'')?json.session_id:null;
  } catch {return null;}
}
export function createTrainingExportAuthServices({
  bearerToken,authClient,serverClient,authorizeDurableRequest,
  storageAdapter,archiveSink,
}) {
  if(typeof authClient?.auth?.getUser!=='function'
   ||typeof serverClient?.schema!=='function'
   ||typeof authorizeDurableRequest!=='function'
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
    // Do not cache getUser: a deleted user must be rejected between archive
    // retrieval and persistence as well as on the initial request.
    const response=await authClient.auth.getUser(bearerToken);
    const ownerId=response?.data?.user?.id;
    if(response?.error||!UUID.test(ownerId??'')) {
      throw new Error('Current Auth user unavailable');
    }
    const {data:gate,error}=await serverClient.schema('allin_private')
      .rpc('v2_account_export_authorize_session_candidate',{
        p_user_id:ownerId,p_session_id:sessionId,
      });
    if(error||gate?.ownerId!==ownerId||gate?.sessionId!==sessionId
      ||gate?.activeSession!==true||gate?.exportPermitted!==true
      ||gate?.completeUserExport!==false) {
      throw new Error('Active Auth session not authorized for private export');
    }
    const request=await authorizeDurableRequest({requestId,ownerId,sessionId});
    if(request?.requestId!==requestId||request?.ownerId!==ownerId
      ||request?.status!=='approved'||request?.cancelled===true
      ||typeof request.expiresAt!=='string'
      ||!Number.isFinite(Date.parse(request.expiresAt))
      ||Date.parse(request.expiresAt)<=Date.now()
      ||Date.parse(request.expiresAt)>Date.now()+24*60*60*1000) {
      throw new Error('Owner export request missing, expired or revoked');
    }
    return {ownerId,activeSession:true,exportPermitted:true};
  }
  return Object.freeze({
    authorizeExport,
    listEvidence:storageAdapter.listEvidence,
    downloadPrivateObject:storageAdapter.downloadPrivateObject,
    writeEncryptedArchive:archiveSink.writeEncryptedArchive,
    deleteStagedArchive:archiveSink.deleteStagedArchive,
  });
}
