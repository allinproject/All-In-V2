/**
 * ALL-251 source-only upload ingress. NOT imported by deployed worker.mjs.
 * No route becomes public until independent signer custody, hosted RPC,
 * recovery and all ALL-222/251 acceptance gates are proven.
 *
 * Auth is checked by the injected canonical writer BEFORE streaming body.
 * A caller cannot choose owner, bucket, object path, upsert or overwrite.
 */
const MAX_BYTES=8*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reply(code,status){
 return new Response(JSON.stringify({code}),{
  status,headers:{'content-type':'application/json',
   'cache-control':'no-store','x-content-type-options':'nosniff'},
 });
}
export async function readAll251BoundedBody(request,maxBytes=MAX_BYTES){
 if(!request.body||typeof request.body.getReader!=='function')
  throw Error('PAYLOAD_REQUIRED');
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(declared)||
   !Number.isSafeInteger(Number(declared))||
   Number(declared)<1||Number(declared)>maxBytes))
  throw Error('PAYLOAD_LIMIT');
 const reader=request.body.getReader(),chunks=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))throw Error('PAYLOAD_INVALID');
   size+=value.byteLength;
   if(size>maxBytes)throw Error('PAYLOAD_LIMIT');
   chunks.push(value);
  }
  if(size<1)throw Error('PAYLOAD_REQUIRED');
  if(declared!==null&&size!==Number(declared))
   throw Error('PAYLOAD_MISMATCH');
  const out=new Uint8Array(size);
  let i=0;
  for(const bytes of chunks){out.set(bytes,i);i+=bytes.byteLength;}
  return out;
 }catch(e){
  // Best effort cancel remaining stream; don't turn failed reads into bytes.
  try{await reader.cancel();}catch{}
  throw e;
 }finally{reader.releaseLock();}
}
export function createAll251UploadIngressReview({internalWriter}){
 if(typeof internalWriter?.writeNewObjectFromVerifiedRequest!=='function')
  throw Error('CANONICAL_WRITER_REQUIRED');
 return async function handleUpload(request){
  try{
   if(request.method!=='POST')return reply('METHOD_DENIED',405);
   const url=new URL(request.url);
   const match=/^\/v1\/workouts\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
   if(!match||!UUID.test(match[1])||url.search)
    return reply('PATH_DENIED',404);
   const contentType=request.headers.get('content-type');
   if(contentType!=='application/octet-stream'||
      request.headers.has('content-encoding'))
    return reply('CONTENT_TYPE_DENIED',415);
   const length=request.headers.get('content-length');
   if(length!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(length)||
      Number(length)<1||Number(length)>MAX_BYTES))
    return reply('PAYLOAD_LIMIT',413);
   const receipt=await internalWriter.writeNewObjectFromVerifiedRequest({
    request,objectId:match[1].toLowerCase(),
    loadBytes:()=>readAll251BoundedBody(request),
    contentType:'application/octet-stream',
   });
   if(receipt?.verified!==true)return reply('WRITE_UNVERIFIED',503);
   return reply('CREATED',201);
  }catch(err){
   if(err?.message==='AUTH_DENIED')return reply('AUTH_DENIED',401);
   if(err?.message==='OWNER_PATH_DENIED')return reply('OWNER_PATH_DENIED',403);
   if(err?.message==='PAYLOAD_LIMIT')return reply('PAYLOAD_LIMIT',413);
   if(err?.message==='PAYLOAD_REQUIRED'||err?.message==='PAYLOAD_MISMATCH'||
      err?.message==='PAYLOAD_INVALID')return reply('PAYLOAD_INVALID',400);
   // Do not surface provider, credential, lease, path, token or owner details.
   return reply('STORAGE_NOT_READY',503);
  }
 };
}
