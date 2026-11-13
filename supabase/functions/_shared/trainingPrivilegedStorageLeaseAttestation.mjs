/**
 * ALL-251 reviewed adapter for the EXISTING createPrivilegedStorageWriter({leaseAuthority}).
 * Never initialize in client/browser code or shared functions with service-role
 * credentials. The signing material must be provisioned separately and held
 * only by the canonical dedicated writer, NOT by project-wide API consumers.
 * No automatic expiry/settlement of a durable lease after a write timeout.
 * Review-only until provider-level REST/S3/signed/TUS isolation is proven.
 */
import {createHash,createHmac,randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME=/^[A-Za-z0-9._/-]+$/;
const BUCKETS=new Set(['v2-private-workout-objects','v2-private-account-exports']);
const hash=b=>createHash('sha256').update(b).digest('hex');
export function createAttestedPrivilegedStorageLeaseAuthority({
 supabase,getSigningKey,keyVersion=1,now=()=>Date.now(),newNonce=randomUUID,
}={}){
 if(typeof supabase?.rpc!=='function'||typeof getSigningKey!=='function'
  ||!Number.isInteger(keyVersion)||keyVersion<1||keyVersion>1000
  ||typeof now!=='function'||typeof newNonce!=='function')
  throw Error('Dedicated trusted attested Storage writer dependencies required');
 const opened=new Map();
 async function mac(parts){
  const raw=await getSigningKey();
  if(!(raw instanceof Uint8Array)||raw.byteLength!==32)
   throw Error('Trusted 32-byte writer signing key unavailable');
  const own=Buffer.from(raw);
  try{return createHmac('sha256',own).update(parts.join('\n'),'utf8').digest('hex');}
  finally{own.fill(0);}
 }
 function scope({ownerId,bucketId,path,operation,bytes}){
  if(!UUID.test(ownerId??'')||!BUCKETS.has(bucketId)||!NAME.test(path??'')
   ||path.length>1024||!path.startsWith(ownerId+'/')
   ||path.split('/').some(x=>!x||x==='.'||x==='..')
   ||!['create','replace'].includes(operation)
   ||!(bytes instanceof Uint8Array)||bytes.byteLength<1)
   throw Error('Invalid attested Storage owner/bucket/path/body scope');
 }
 function expiry(){return Math.floor(now()/1000)+60}
 return Object.freeze({
  async begin({ownerId,bucketId,path,operation,bytes}){
   scope({ownerId,bucketId,path,operation,bytes});
   const digest=hash(bytes),nonce=newNonce(),expires=expiry();
   if(!UUID.test(nonce))throw Error('Cryptographic nonce required');
   const signature=await mac(['all251-begin-v1',ownerId,bucketId,path,
    operation,digest,nonce,String(expires),String(keyVersion)]);
   const result=await supabase.rpc('v2_begin_attested_privileged_storage_write_review',{
    p_owner:ownerId,p_bucket:bucketId,p_path:path,p_operation:operation,
    p_sha256:digest,p_nonce:nonce,p_expires_epoch:expires,
    p_key_version:keyVersion,p_mac:signature,
   });
   if(result?.error||!UUID.test(result?.data??''))
    throw Error('Attested durable Storage lease denied');
   const leaseId=result.data;
   opened.set(leaseId,{ownerId,bucketId,path,operation,nonce,digest});
   return {data:leaseId,error:null};
  },
  async settle({ownerId,leaseId,bucketId,path,operation,bytes}){
   const expected=opened.get(leaseId);
   scope({ownerId,bucketId,path,operation,bytes});
   if(!expected||expected.ownerId!==ownerId||expected.bucketId!==bucketId
    ||expected.path!==path||expected.operation!==operation
    ||expected.digest!==hash(bytes))
    throw Error('Cannot settle unverified writer or changed byte digest');
   const expires=expiry();
   const signature=await mac(['all251-settle-v1',ownerId,leaseId,
    expected.nonce,expected.digest,String(expires),String(keyVersion)]);
   const result=await supabase.rpc('v2_settle_attested_privileged_storage_write_review',{
    p_owner:ownerId,p_lease:leaseId,p_sha256:expected.digest,
    p_expires_epoch:expires,p_mac:signature,
   });
   if(result?.error||result?.data!==true)
    throw Error('Durable attested lease settlement denied; deletion remains frozen');
   opened.delete(leaseId);
   return {data:true,error:null};
  },
 });
}
