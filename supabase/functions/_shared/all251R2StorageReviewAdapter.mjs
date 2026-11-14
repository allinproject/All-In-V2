/**
 * ALL-251 REVIEW ONLY: R2 bucket-binding adapter for the existing canonical
 * privileged Storage writer. Not an HTTP handler or deployable credential.
 * Only the separately trusted runtime may construct this capability.
 *
 * The canonical writer owns Auth verification, a durable deletion lease,
 * byte-for-byte readback, and lease settlement. This adapter owns neither
 * user identity nor authorization and MUST NEVER be exposed to a client.
 */
const BUCKETS=new Set(['v2-private-workout-objects','v2-private-account-exports']);
const validKey=key=>typeof key==='string'&&key.length>0&&key.length<=1024&&
 !key.startsWith('/')&&key.split('/').every(segment=>
  segment.length>0&&segment!=='.'&&segment!=='..'&&
  !/[\\\u0000-\u001f]/.test(segment));
const failure=code=>({data:null,error:{code}});
export function createAll251R2StorageFacade({binding,logicalBucketId}){
 if(!BUCKETS.has(logicalBucketId)||
  typeof binding?.put!=='function'||typeof binding?.get!=='function'||
  typeof binding?.head!=='function')
  throw Error('Approved private R2 binding required');
 function from(requestedBucket){
  if(requestedBucket!==logicalBucketId)
   throw Error('Unapproved private media bucket');
  return Object.freeze({
   async upload(path,bytes,{upsert=false,contentType}={}){
    if(!validKey(path)||!(bytes instanceof Uint8Array)||bytes.length===0||
      upsert!==false||typeof contentType!=='string')
     return failure('INVALID_CREATE');
    try{
     // Atomic create-only. A competing writer cannot silently overwrite.
     const stored=await binding.put(path,bytes,{
      onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType},
     });
     return stored?{data:{path},error:null}:failure('EXISTS_OR_CONFLICT');
    }catch{return failure('WRITE_UNVERIFIED');}
   },
   async update(path,bytes,{contentType}={}){
    if(!validKey(path)||!(bytes instanceof Uint8Array)||bytes.length===0||
      typeof contentType!=='string')
     return failure('INVALID_REPLACE');
    try{
     const existing=await binding.head(path);
     if(!existing||typeof existing.etag!=='string')
      return failure('MISSING_OBJECT');
     // ETag compare-and-swap prevents an unnoticed concurrent overwrite.
     const stored=await binding.put(path,bytes,{
      onlyIf:{etagMatches:existing.etag},httpMetadata:{contentType},
     });
     return stored?{data:{path},error:null}:failure('REPLACE_CONFLICT');
    }catch{return failure('WRITE_UNVERIFIED');}
   },
   async download(path){
    if(!validKey(path))return failure('INVALID_KEY');
    try{
     const object=await binding.get(path);
     if(!object||typeof object.arrayBuffer!=='function')
      return failure('NOT_FOUND');
     return {data:{arrayBuffer:()=>object.arrayBuffer()},error:null};
    }catch{return failure('READ_UNVERIFIED');}
   },
  });
 }
 return Object.freeze({from});
}
