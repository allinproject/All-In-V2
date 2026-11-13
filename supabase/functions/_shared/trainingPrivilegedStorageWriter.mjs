/**
 * ALL-251 staged/server-only controlled privileged Storage writer.
 *
 * Owner identity MUST be verified by the calling server from Auth, not read
 * from a user-supplied ownerId field. The service-role key never leaves the
 * server and must have no alternate upload users when this is deployed.
 *
 * The database creates a durable non-expiring write lease under the deletion
 * request's advisory transaction lock. Every upload/replace must hold that
 * lease until a privileged download proves the exact bytes were written.
 * On ANY timeout, ambiguous result, network error or readback mismatch,
 * deliberately DO NOT settle: deletion stays blocked until independent
 * operator reconciliation. Never return a release-ready deletion receipt.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_BUCKETS=new Set(['v2-private-workout-objects','v2-private-account-exports']);
export const MAX_PRIVILEGED_STORAGE_BYTES=8*1024*1024;
const validPath=(path,ownerId)=>typeof path==='string'&&path.length<=1024&&
 path.startsWith(ownerId+'/') && path.split('/').every(x=>x&&
 x!=='.'&&x!=='..'&&!/[\\\u0000-\u001f]/.test(x));
function equalBytes(a,b) {
 if(a.length!==b.length)return false;
 let mismatch=0;
 for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];
 return mismatch===0;
}
export function createPrivilegedStorageWriter({supabase}) {
 if(!supabase || typeof supabase.rpc!=='function'||
  typeof supabase.storage?.from!=='function')
  throw Error('Trusted server-only Supabase Storage writer required');
 return Object.freeze({
  async write({verifiedOwnerId,bucketId,path,bytes,operation,contentType}) {
   if(!UUID.test(verifiedOwnerId??'')||!ALLOWED_BUCKETS.has(bucketId)||
    !validPath(path,verifiedOwnerId)||
    !['create','replace'].includes(operation)||
    !(bytes instanceof Uint8Array)||bytes.length===0||
    bytes.length>MAX_PRIVILEGED_STORAGE_BYTES||
    typeof contentType!=='string'||contentType.length>100||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType))
    throw Error('Invalid scoped privileged Storage upload');
   // Only canonical DB write-lease RPC can grant a write. No bare
   // in-memory status preflight can substitute for this durable lease.
   const leased=await supabase.rpc('v2_begin_privileged_storage_write_review',{
    p_owner_id:verifiedOwnerId,p_bucket_id:bucketId,
    p_object_path:path,p_operation:operation,
   });
   if(leased?.error||!UUID.test(leased?.data??''))
    throw Error('Durable privileged Storage write lease unavailable');
   const leaseId=leased.data;
   const store=supabase.storage.from(bucketId);
   // Do not settle a lease after a failed/ambiguous write. The backend
   // might still commit after a timeout: deletion must remain blocked.
   const uploaded=operation==='create'
    ? await store.upload(path,bytes,{upsert:false,contentType})
    : await store.update(path,bytes,{contentType});
   if(uploaded?.error||uploaded?.data?.path!==path)
    throw Error('Privileged Storage write outcome unverified; lease remains open');
   // Require real privileged bytes to round-trip before releasing the
   // lease. A successful metadata response alone is insufficient.
   const read=await store.download(path);
   if(read?.error||!read?.data||typeof read.data.arrayBuffer!=='function')
    throw Error('Privileged Storage readback unavailable; lease remains open');
   const observed=new Uint8Array(await read.data.arrayBuffer());
   if(!equalBytes(observed,bytes))
    throw Error('Privileged Storage bytes differ; lease remains open');
   const settled=await supabase.rpc('v2_settle_privileged_storage_write_review',{
    p_owner_id:verifiedOwnerId,p_lease_id:leaseId,
   });
   if(settled?.error||settled?.data!==true)
    throw Error('Storage lease settlement unverified; deletion remains blocked');
   return Object.freeze({bucketId,path,verified:true});
  },
 });
}
