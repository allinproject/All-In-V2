/**
 * ALL-251 REVIEW ONLY — private, expiring encrypted account-export archive
 * persistence for the EXISTING export workflow. NOT deployed; no bucket created.
 *
 * A trusted server must provide a service-role Supabase client and a live
 * owner/session/request-validated expiry lookup. No arbitrary bucket/path,
 * user-supplied URL, signed link or direct client Storage access.
 */
export const PRIVATE_ACCOUNT_EXPORT_BUCKET='v2-private-account-exports';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENVELOPE_BYTES=25*1024*1024;

function archivePath(ownerId,requestId) {
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??''))
   throw new Error('Exact export archive owner and request required');
 return ownerId+'/'+requestId+'/archive.aesgcm.json';
}
export function createSupabasePrivateArchivePersistence({
 serviceClient,readApprovedRequestExpiry,
}) {
 if(typeof serviceClient?.storage?.getBucket!=='function'
    ||typeof serviceClient?.storage?.from!=='function'
    ||typeof readApprovedRequestExpiry!=='function') {
   throw new Error('Trusted private archive persistence dependencies required');
 }
 async function checkBucket(){
   const {data,error}=await serviceClient.storage.getBucket(PRIVATE_ACCOUNT_EXPORT_BUCKET);
   if(error||data?.id!==PRIVATE_ACCOUNT_EXPORT_BUCKET||data.public!==false)
     throw new Error('Private encrypted account-export bucket unavailable or public');
 }
 return Object.freeze({
  async persistPrivateEnvelope({ownerId,requestId,envelope}) {
   const path=archivePath(ownerId,requestId);
   if(!envelope||envelope.ownerId!==ownerId
     ||envelope.requestId!==requestId
     ||envelope.version!=='allin-v2-training-encrypted-export-v1'
     ||envelope.algorithm!=='AES-256-GCM'
     ||envelope.completeUserExport!==false
     ||envelope.downloadAuthorized!==false
     ||typeof envelope.ciphertext!=='string'||!envelope.ciphertext) {
     throw new Error('Unverified encrypted archive envelope');
   }
   // Expiry comes from the owning ALL-251 approved-request record, not the
   // caller and not the bucket response. Persist only inside that lease.
   const approved=await readApprovedRequestExpiry({ownerId,requestId});
   const expiry=Date.parse(approved?.expiresAt??'');
   if(approved?.ownerId!==ownerId||approved?.requestId!==requestId
     ||approved?.status!=='approved'||approved?.cancelled!==false
     ||!Number.isFinite(expiry)||expiry<=Date.now()
     ||expiry>Date.now()+24*60*60*1000) {
     throw new Error('Export lease is missing or expired');
   }
   await checkBucket();
   const bytes=new TextEncoder().encode(JSON.stringify(envelope));
   if(bytes.byteLength===0||bytes.byteLength>MAX_ENVELOPE_BYTES)
     throw new Error('Encrypted archive exceeds persistence bound');
   // Never upsert another archive or downgrade bucket privacy.
   const {data,error}=await serviceClient.storage.from(PRIVATE_ACCOUNT_EXPORT_BUCKET)
     .upload(path,new Blob([bytes],{type:'application/octet-stream'}),{
       upsert:false,contentType:'application/octet-stream',cacheControl:'0',
     });
   if(error||data?.path!==path)
     throw new Error('Private encrypted archive upload was not confirmed');
   return {ownerId,requestId,archiveId:path,encrypted:true,private:true,
     expiresAt:approved.expiresAt};
  },
  async deletePrivateRequest({ownerId,requestId}) {
   const path=archivePath(ownerId,requestId);
   await checkBucket();
   // Storage API removal, never SQL DELETE of storage.objects: SQL deletion
   // leaves physical object bytes orphaned.
   const {data,error}=await serviceClient.storage
     .from(PRIVATE_ACCOUNT_EXPORT_BUCKET).remove([path]);
   if(error||!Array.isArray(data)||!data.some(x=>x?.name===path)) {
     throw new Error('Private archive removal not confirmed');
   }
   return true;
  },
 });
}
