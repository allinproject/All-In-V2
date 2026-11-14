/**
 * ALL-251 optional server-only attested lease authority.
 * The signing key is distinct from Supabase service-role, held ONLY by
 * trusted writer runtime, provisioned out-of-band. Never export to clients.
 * Activating this requires the matching reviewed DB functions and revocation
 * of unsigned service-role RPC grants; local-only until accepted.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decoder=new TextEncoder();
const hex=u8=>Array.from(u8,x=>x.toString(16).padStart(2,'0')).join('');
export function createAttestedPrivilegedStorageLeaseAuthority({supabase,signingKey}){
 if(!supabase||typeof supabase.rpc!=='function'||
  !(signingKey instanceof Uint8Array)||signingKey.length!==32)
  throw Error('Privileged writer signing material and service RPC required');
 // Import a copy, not a caller-modifiable Uint8Array view.
 const keyImport=crypto.subtle.importKey('raw',new Uint8Array(signingKey),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 async function attest(action,{ownerId,bucketId,path,operation,bytes,leaseId}){
  if(!UUID.test(ownerId??'')||!['begin','settle','cancel'].includes(action)||
   typeof bucketId!=='string'||typeof path!=='string'||
   !['create','replace'].includes(operation)||
   !(bytes instanceof Uint8Array)||bytes.length===0||
   (action==='begin'&&leaseId!==undefined)||
   (action!=='begin'&&!UUID.test(leaseId??'')))
   throw Error('Untrusted Storage attestation scope');
  const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  const nonce=crypto.randomUUID();
  const epoch=Math.floor(Date.now()/1000);
  const payload=['v2-writer-v1',action,ownerId,bucketId,path,operation,digest,
   leaseId??'',nonce,String(epoch)].join('|');
  const key=await keyImport;
  const signature=hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,
   decoder.encode(payload))));
  return {digest,nonce,epoch,signature};
 }
 return Object.freeze({
  async begin({ownerId,bucketId,path,operation,bytes}){
   const proof=await attest('begin',{ownerId,bucketId,path,operation,bytes});
   return supabase.rpc('v2_begin_privileged_storage_write_attested_review',{
    p_owner_id:ownerId,p_bucket_id:bucketId,p_object_path:path,
    p_operation:operation,p_sha256:proof.digest,p_nonce:proof.nonce,
    p_issued_epoch:proof.epoch,p_signature:proof.signature,
   });
  },
  async settle({ownerId,leaseId,bucketId,path,operation,bytes}){
   const proof=await attest('settle',{
    ownerId,leaseId,bucketId,path,operation,bytes,
   });
   return supabase.rpc('v2_settle_privileged_storage_write_attested_review',{
    p_owner_id:ownerId,p_lease_id:leaseId,p_nonce:proof.nonce,
    p_issued_epoch:proof.epoch,p_signature:proof.signature,
   });
  },
  // Cancellation is NOT successful upload settlement. Requires a matching
  // service-only SQL review RPC and independent provider-session revocation.
  // Do not enable deletion based solely on this database transition.
  async cancel({ownerId,leaseId,bucketId,path,operation,bytes}){
   const proof=await attest('cancel',{
    ownerId,leaseId,bucketId,path,operation,bytes,
   });
   return supabase.rpc('v2_cancel_privileged_storage_write_attested_review',{
    p_owner_id:ownerId,p_lease_id:leaseId,p_bucket_id:bucketId,
    p_object_path:path,p_operation:operation,p_sha256:proof.digest,
    p_nonce:proof.nonce,p_issued_epoch:proof.epoch,
    p_signature:proof.signature,
   });
  },
 });
}
