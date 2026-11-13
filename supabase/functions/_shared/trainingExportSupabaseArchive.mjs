/**
 * ALL-251 REVIEW ONLY — private, expiring encrypted account-export archive
 * persistence for the EXISTING export workflow. NOT deployed; no bucket created.
 *
 * A trusted server must provide a service-role Supabase client and a live
 * owner/session/request-validated expiry lookup and a trusted write barrier.
 * The callback contract alone does NOT establish DB/Storage atomicity;
 * release requires independently proven durable leases and claim fencing.
 * No arbitrary bucket/path,
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
 serviceClient,readApprovedRequestExpiry,withOwnerStorageWriteBarrier,
}) {
 if(typeof serviceClient?.storage?.getBucket!=='function'
    ||typeof serviceClient?.storage?.from!=='function'
    ||typeof readApprovedRequestExpiry!=='function'
    ||typeof withOwnerStorageWriteBarrier!=='function') {
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
   // Privileged uploads bypass Storage RLS. The trusted server must
   // surround the HTTP write with its durable deletion/write barrier.
   // A standalone DB preflight is not an atomic barrier.
   let writes=0;
   const result=await withOwnerStorageWriteBarrier({
     ownerId,requestId,bucketId:PRIVATE_ACCOUNT_EXPORT_BUCKET,objectPath:path,
     operation:'insert',write:async()=>{
       writes++;
       if(writes!==1)throw Error('Private archive write called more than once');
       return serviceClient.storage.from(PRIVATE_ACCOUNT_EXPORT_BUCKET)
         .upload(path,new Blob([bytes],{type:'application/octet-stream'}),{
           upsert:false,contentType:'application/octet-stream',cacheControl:'0',
         });
     },
   });
   if(writes!==1)throw Error('Private archive barrier did not execute write');
   const {data,error}=result??{};
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

/**
 * ALL-251 REVIEW ONLY — retention purge slice for the EXISTING private archive.
 * Not a scheduled job and not reachable by a mobile/anonymous endpoint.
 * The server-only enumerator must read authoritative expired/cancelled approved
 * requests, never client-supplied paths. The same storage.deletePrivateRequest
 * routine above must remove bytes; no direct SQL deletion of storage.objects.
 *
 * A failed remove or audit receipt is operationally unresolved, never success.
 */
export async function purgeExpiredAccountExportArchives({
  listPurgeCandidates, deletePrivateRequest, recordPurgeReceipt,
  now = () => Date.now(), maxRequests = 50,
}) {
  if (typeof listPurgeCandidates!=='function'
    || typeof deletePrivateRequest!=='function'
    || typeof recordPurgeReceipt!=='function'
    || typeof now!=='function'
    || !Number.isInteger(maxRequests) || maxRequests<1 || maxRequests>100) {
    throw new Error('Trusted account-export retention adapters required');
  }
  const rows=await listPurgeCandidates({limit:maxRequests});
  if(!Array.isArray(rows) || rows.length>maxRequests) {
    throw new Error('Retention candidate enumeration unbounded');
  }
  const current=now();
  if(!Number.isFinite(current)) throw new Error('Invalid retention clock');
  const seen=new Set();
  // Validate the entire batch before deleting the first encrypted archive.
  for(const row of rows) {
    const key=String(row?.ownerId)+'/'+String(row?.requestId);
    const expiry=Date.parse(row?.expiresAt??'');
    if(!UUID.test(row?.ownerId??'') || !UUID.test(row?.requestId??'')
      || seen.has(key) || !Number.isFinite(expiry)
      || !['expired','cancelled','approved','staged','failed'].includes(row?.status)
      || (row.status!=='cancelled' && expiry>current)) {
      throw new Error('Unapproved account-export retention candidate');
    }
    seen.add(key);
  }
  const receipts=[];
  for(const {ownerId,requestId} of rows) {
    const confirmed=await deletePrivateRequest({ownerId,requestId});
    if(confirmed!==true) throw new Error('Private archive purge not confirmed');
    const receipt=await recordPurgeReceipt({ownerId,requestId});
    if(receipt?.ownerId!==ownerId || receipt?.requestId!==requestId
      || receipt?.purged!==true) {
      throw new Error('Retention audit receipt missing; manual reconciliation required');
    }
    receipts.push({ownerId,requestId,purged:true});
  }
  return {purgedCount:receipts.length,receipts};
}

/**
 * ALL-251 REVIEW ONLY: chunk storage for the same private export bucket and
 * approved owner/request. Implements the trusted adapter shape consumed by
 * trainingExportLargeArchive.mjs; never creates a signed URL or exposes keys.
 * The existing request/session authorization must be performed by the caller
 * for every streamed page; this adapter additionally checks the request lease.
 */
export function createSupabasePagedAccountExportStorage({
 serviceClient,readApprovedRequestExpiry,withOwnerStorageWriteBarrier,
}) {
 if(typeof serviceClient?.storage?.getBucket!=='function'
  ||typeof serviceClient?.storage?.from!=='function'
  ||typeof readApprovedRequestExpiry!=='function'
  ||typeof withOwnerStorageWriteBarrier!=='function')
  throw Error('Trusted paged account archive services and write barrier required');
 const part=(ownerId,requestId)=>{
  if(!UUID.test(ownerId??'')||!UUID.test(requestId??''))
   throw Error('Exact owner and request required');
  return ownerId+'/'+requestId;
 };
 const pageName=(collection,index)=>{
  if((!/^[a-z][a-z0-9_.]{0,63}$/.test(collection??'') || collection.includes('..'))
   ||!Number.isInteger(index)||index<0||index>20000)
   throw Error('Invalid private archive page identity');
  return collection+'_'+index+'.page.json';
 };
 async function gate(ownerId,requestId) {
  const approved=await readApprovedRequestExpiry({ownerId,requestId});
  const expiry=Date.parse(approved?.expiresAt??'');
  if(approved?.ownerId!==ownerId||approved?.requestId!==requestId
   ||!['approved','staging','staged'].includes(approved?.status)
   ||approved.cancelled!==false||!Number.isFinite(expiry)
   ||expiry<=Date.now()||expiry>Date.now()+24*60*60*1000)
   throw Error('Account archive request lease invalid');
  const {data,error}=await serviceClient.storage.getBucket(PRIVATE_ACCOUNT_EXPORT_BUCKET);
  if(error||data?.id!==PRIVATE_ACCOUNT_EXPORT_BUCKET||data.public!==false)
   throw Error('Account export archive bucket is not private');
 }
 async function write(ownerId,requestId,path,obj){
  const raw=new TextEncoder().encode(JSON.stringify(obj));
  if(raw.byteLength===0||raw.byteLength>MAX_ENVELOPE_BYTES)
   throw Error('Oversized private export object');
  let writes=0;
  const result=await withOwnerStorageWriteBarrier({
   ownerId,requestId,bucketId:PRIVATE_ACCOUNT_EXPORT_BUCKET,objectPath:path,
   operation:'insert',write:async()=>{
    writes++;
    if(writes!==1)throw Error('Private page write called more than once');
    return serviceClient.storage.from(PRIVATE_ACCOUNT_EXPORT_BUCKET)
     .upload(path,new Blob([raw],{type:'application/octet-stream'}),{
      upsert:false,contentType:'application/octet-stream',cacheControl:'0',
     });
   },
  });
  if(writes!==1)throw Error('Private page barrier did not execute write');
  const {data,error}=result??{};
  if(error||data?.path!==path)throw Error('Private account export write unconfirmed');
 }
 async function read(ownerId,requestId,path){
  await gate(ownerId,requestId);
  const {data,error}=await serviceClient.storage.from(PRIVATE_ACCOUNT_EXPORT_BUCKET).download(path);
  if(error||!data||typeof data.arrayBuffer!=='function'
    ||(Number.isFinite(data.size)&&data.size>MAX_ENVELOPE_BYTES))
    throw Error('Private account export read denied');
  const bytes=await data.arrayBuffer();
  if(bytes.byteLength>MAX_ENVELOPE_BYTES)throw Error('Oversized account export read');
  return JSON.parse(new TextDecoder().decode(bytes));
 }
 return Object.freeze({
  async writePrivatePage({ownerId,requestId,collection,index,sealed}){
   const base=part(ownerId,requestId);
   const name=pageName(collection,index);
   await gate(ownerId,requestId);
   if(typeof sealed?.ciphertext!=='string'||!sealed.ciphertext)
     throw Error('Missing encrypted account export page');
   await write(ownerId,requestId,base+'/pages/'+name,sealed);
   return {ownerId,requestId,collection,index,stored:true};
  },
  async commitPrivateManifest({ownerId,requestId,manifest}){
   const base=part(ownerId,requestId);
   await gate(ownerId,requestId);
   if(manifest?.ownerId!==ownerId||manifest?.requestId!==requestId
     ||manifest?.completeUserExport!==true)
     throw Error('Incomplete export manifest refused');
   await write(ownerId,requestId,base+'/manifest.json',manifest);
   return {ownerId,requestId,committed:true};
  },
  async readPrivateManifest({ownerId,requestId}){
   return read(ownerId,requestId,part(ownerId,requestId)+'/manifest.json');
  },
  async readPrivatePage({ownerId,requestId,collection,index}){
   return read(ownerId,requestId,part(ownerId,requestId)+'/pages/'+pageName(collection,index));
  },
  async purgePrivateRequest({ownerId,requestId}){
   const base=part(ownerId,requestId),bucket=serviceClient.storage.from(PRIVATE_ACCOUNT_EXPORT_BUCKET);
   // Cleanup must still work for expired/revoked requests: never require a
   // currently approved lease for purging bytes, but require private bucket.
   const b=await serviceClient.storage.getBucket(PRIVATE_ACCOUNT_EXPORT_BUCKET);
   if(b.error||b.data?.id!==PRIVATE_ACCOUNT_EXPORT_BUCKET||b.data.public!==false)
     throw Error('Private archive purge bucket unavailable');
   const paths=[];const seen=new Set();
   for(let offset=0;offset<=20000;offset+=1000){
    const {data,error}=await bucket.list(base+'/pages',{limit:1000,offset});
    if(error||!Array.isArray(data))throw Error('Private page cleanup listing failed');
    for(const entry of data){
     const name=entry?.name;
     if((!/^[a-z][a-z0-9_.]{0,63}_[0-9]+\.page\.json$/.test(name??'') || name.includes('..'))
      ||seen.has(name))throw Error('Unexpected account export cleanup entry');
     seen.add(name);paths.push(base+'/pages/'+name);
    }
    if(data.length<1000)break;
    if(offset===20000)throw Error('Account export cleanup exceeded page bound');
   }
   paths.push(base+'/manifest.json');
   // An uncommitted manifest may not exist. Storage remove is idempotent,
   // but each returned existing page must have a confirmed delete receipt.
   for(let i=0;i<paths.length;i+=100){
    const chunk=paths.slice(i,i+100);
    const {data,error}=await bucket.remove(chunk);
    if(error||!Array.isArray(data))throw Error('Account export cleanup unconfirmed');
    const removed=new Set(data.map(x=>x?.name));
    const missing=chunk.filter(x=>x!==base+'/manifest.json'&&!removed.has(x));
    if(missing.length)throw Error('Private export pages remain after purge');
   }
   return true;
  },
 });
}
