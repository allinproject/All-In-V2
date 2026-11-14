/**
 * ALL-251 private Storage staging Worker.
 * SOURCE-ONLY REVIEW; no deployment action is configured.
 *
 * Even when deployed by an authorized operator, this handler exposes NO
 * upload, download, delete, presign, or multipart route. Do not add one
 * before Auth + owner/session verification, canonical attested lease gating,
 * R2 readback, independent recovery, and hosted negative acceptance.
 */
const DENY=JSON.stringify({error:'Storage access denied',code:'STORAGE_NOT_READY'});
export default {
 async fetch(_request,_env,_ctx){
  return new Response(DENY,{
   status:403,
   headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
   },
  });
 },
};
