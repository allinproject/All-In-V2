/**
 * ALL-251 — disposable LOCAL Supabase Storage transport for the existing
 * reviewPrivateStorageCleanup contract. Never use in production or hosted.
 * Real release needs a durable upload write barrier, approved bucket policy,
 * and persistent checkpoints. This adapter does NOT provide those.
 *
 * No direct storage.objects SQL deletes or public/client credentials.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,80}$/;
const PAGE = 100;
const MAX_OBJECTS = 10000;
const MAX_DEPTH = 12;
function assertPath(ownerId,path) {
 if(!UUID.test(ownerId??'') || typeof path!=='string' ||
  path.length>1024 || !path.startsWith(ownerId+'/') ||
  path.split('/').some(s=>!s||s==='.'||s==='..'||/[\\\u0000-\u001f]/.test(s)))
  throw Error('ALL-251 foreign or malformed Storage path');
}
const encodePath = p=>p.split('/').map(encodeURIComponent).join('/');
export function createLocalDeletionStorageTransport({
 apiUrl,serviceRoleKey,fetchImpl=fetch,
}) {
 const url=new URL(apiUrl);
 if(url.protocol!=='http:' ||
  !['localhost','127.0.0.1','::1'].includes(url.hostname) ||
  url.port!=='54321' || url.pathname!=='/' ||
  typeof serviceRoleKey!=='string'||serviceRoleKey.length<40 ||
  typeof fetchImpl!=='function')
  throw Error('ALL-251 local-only trusted server Storage transport required');
 async function request(method,path,body) {
  const headers={apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey};
  if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetchImpl(url.origin+'/storage/v1'+path,{
   method,headers,body:body===undefined?undefined:JSON.stringify(body),
  });
  if(!response||typeof response.status!=='number')
   throw Error('Storage transport response unavailable');
  if(response.status>=500)throw Error('Transient Storage server failure');
  return response;
 }
 async function listBucketCatalog() {
  const r=await request('GET','/bucket');
  if(r.status!==200)throw Error('Storage bucket listing failed');
  const buckets=await r.json();
  if(!Array.isArray(buckets))throw Error('Malformed Storage bucket catalog');
  return buckets;
 }
 async function listOwnerStorageObjects({ownerId,bucketId,requestId}) {
  if(!UUID.test(ownerId??'')||!UUID.test(requestId??'') ||
   !BUCKET.test(bucketId??''))throw Error('Exact Storage inventory scope required');
  const paths=[],visited=new Set();
  async function walk(prefix,depth) {
   if(depth>MAX_DEPTH||visited.has(prefix))
    throw Error('Storage directory traversal exceeds safe bounds');
   visited.add(prefix);
   for(let offset=0;;offset+=PAGE) {
    const r=await request('POST','/object/list/'+encodeURIComponent(bucketId),{
     prefix,limit:PAGE,offset,sortBy:{column:'name',order:'asc'},
    });
    if(r.status!==200)throw Error('Storage owner listing failed');
    const rows=await r.json();
    if(!Array.isArray(rows)||rows.length>PAGE)
     throw Error('Malformed Storage owner listing');
    for(const e of rows) {
     if(typeof e?.name!=='string'||!e.name||e.name.includes('/')||
        e.name==='.'||e.name==='..'||/[\\\u0000-\u001f]/.test(e.name))
      throw Error('Malformed Storage catalog entry');
     const full=prefix+'/'+e.name;
     assertPath(ownerId,full);
     if(e.id===null)await walk(full,depth+1);
     else if(typeof e.id==='string' && e.id) {
      paths.push(full);
      if(paths.length>MAX_OBJECTS)throw Error('Storage owner inventory too large');
     }else throw Error('Ambiguous Storage folder/object entry');
    }
    if(rows.length<PAGE)break;
    if(offset+PAGE>=MAX_OBJECTS)throw Error('Storage inventory pagination limit');
   }
  }
  await walk(ownerId,0);
  if(new Set(paths).size!==paths.length)
   throw Error('Duplicate Storage catalog object');
  return {ownerId,bucketId,exhaustive:true,totalCount:paths.length,paths};
 }
 async function objectExists({ownerId,requestId,bucketId,path}) {
  if(!UUID.test(requestId??'')||!BUCKET.test(bucketId??''))
   throw Error('Exact Storage check scope required');
  assertPath(ownerId,path);
  const r=await request('GET','/object/info/'+encodeURIComponent(bucketId)+'/'+encodePath(path));
  if(r.status===200)return true;
  if(r.status===404)return false;
  throw Error('Storage object existence could not be verified');
 }
 async function deleteObject({ownerId,requestId,bucketId,path}) {
  if(!UUID.test(requestId??'')||!BUCKET.test(bucketId??''))
   throw Error('Exact Storage delete scope required');
  assertPath(ownerId,path);
  const r=await request('DELETE','/object/'+encodeURIComponent(bucketId)+'/'+encodePath(path));
  if([200,204].includes(r.status))return {deleted:true};
  if(r.status===404)return {alreadyAbsent:true};
  throw Error('Storage delete not acknowledged');
 }
 return Object.freeze({listBucketCatalog,listOwnerStorageObjects,objectExists,deleteObject});
}
