/**
 * ALL-251 review-only HTTP handler for the EXISTING account export worker.
 * Not deployed, no default URL. The factory must build the canonical worker
 * with a server-only Auth client, service-role client and KMS adapter.
 * No owner ID or Storage path may be accepted from caller-supplied input.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers={
 'Content-Type':'application/json',
 'Cache-Control':'no-store',
 'Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff',
};
function error(status,code) {
 return new Response(JSON.stringify({code}),{status,headers});
}
export async function handleAccountExportDownload(request,{
 enabled=false,createAuthorizedWorker,
}={}) {
 if(!enabled) return error(503,'account_export_disabled');
 if(request?.method!=='POST')return error(405,'method_not_allowed');
 if(typeof createAuthorizedWorker!=='function')return error(503,'account_export_not_configured');
 if(request.headers.get('origin'))return error(403,'cross_origin_denied');
 const authorization=request.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(authorization))
   return error(401,'authentication_required');
 const bodySize=Number(request.headers.get('content-length')??0);
 if(!Number.isFinite(bodySize)||bodySize<0||bodySize>1024)
   return error(413,'invalid_request');
 let input;
 try {
  const raw=await request.text();
  if(raw.length>1024)throw Error('oversize');
  input=JSON.parse(raw);
 }catch{return error(400,'invalid_request');}
 if(!input||typeof input!=='object'||Array.isArray(input)
   ||Object.keys(input).length!==1||!UUID.test(input.request_id??''))
   return error(400,'invalid_request');
 try {
  const worker=await createAuthorizedWorker(authorization.slice(7));
  if(typeof worker?.openApprovedLargeHistoryDownload!=='function')
    return error(503,'account_export_not_configured');
  // The worker verifies Auth.getUser + current session/request for every
  // page and every download, never trusts the request body as owner evidence.
  const response=await worker.openApprovedLargeHistoryDownload(input.request_id);
  if(!(response instanceof Response)||response.status!==200)
    return error(503,'account_export_unavailable');
  // A configured worker must return the canonical private, non-cacheable
  // archive stream. Never pass through a public/CORS-readable or arbitrary
  // 200 response just because an adapter claimed to be authorized.
  if(!/^application\/x-ndjson(?:;|$)/i.test(response.headers.get('content-type')??'')
    ||!/\bno-store\b/i.test(response.headers.get('cache-control')??'')
    ||response.headers.has('access-control-allow-origin')
    ||response.headers.get('x-content-type-options')!=='nosniff'
    ||response.body===null) {
    await response.body?.cancel().catch(()=>{});
    return error(503,'account_export_unavailable');
  }
  return response;
 }catch{
  // Never leak user existence, request state, provider identifiers or keys.
  return error(403,'account_export_unavailable');
 }
}
