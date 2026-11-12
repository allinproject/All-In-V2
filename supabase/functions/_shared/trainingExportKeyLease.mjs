/**
 * ALL-251 REVIEW ONLY: KMS lease adapter for the EXISTING
 * resolveEncryptionKey(ownerId,requestId) dependency.
 *
 * No new persistence store, no unwrapped key serialization and no
 * production provider. The trusted backend supplies the existing account
 * export approval lookup and a provider-specific key unwrapping operation.
 * A KMS key ID is NOT authorization: every resolve checks the current
 * account, exact export request, lease expiry, purpose, key version and
 * cancellation. Production use requires an approved KMS key policy.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_LEASE_MS=24*60*60*1000;
function verifiedId(s){return typeof s==='string'&&UUID.test(s);}
export function createAccountExportKeyLease({readApprovedRequestKeyLease,unwrapDataKey,clock=()=>Date.now()}={}){
 if(typeof readApprovedRequestKeyLease!=='function'||typeof unwrapDataKey!=='function'
   ||typeof clock!=='function')throw Error('Trusted export KMS lease dependencies required');
 return Object.freeze({
  async resolveEncryptionKey({ownerId,requestId}){
   if(!verifiedId(ownerId)||!verifiedId(requestId))
    throw Error('Exact key lease owner and request required');
   const now=clock();
   const lease=await readApprovedRequestKeyLease({ownerId,requestId});
   const until=Date.parse(lease?.expiresAt??'');
   if(lease?.ownerId!==ownerId||lease?.requestId!==requestId
     ||lease?.status!=='approved'||lease.cancelled!==false
     ||lease.activeSession!==true||lease.keyPurpose!=='account-export-v2'
     ||!Number.isSafeInteger(lease.keyVersion)||lease.keyVersion<1
     ||typeof lease.kmsKeyId!=='string'||lease.kmsKeyId.length<8
     ||typeof lease.wrappedDataKey!=='string'||lease.wrappedDataKey.length<16
     ||!Number.isFinite(until)||until<=now||until>now+MAX_LEASE_MS)
    throw Error('Account export key lease denied');
   const bytes=await unwrapDataKey({
    kmsKeyId:lease.kmsKeyId,wrappedDataKey:lease.wrappedDataKey,
    keyVersion:lease.keyVersion,purpose:lease.keyPurpose,
    context:{ownerId,requestId},
   });
   if(!(bytes instanceof Uint8Array)||bytes.byteLength!==32)
    throw Error('Invalid server KMS data key');
   // A revocation or rotation racing the KMS unwrap must deny the result.
   const after=await readApprovedRequestKeyLease({ownerId,requestId});
   if(after?.ownerId!==ownerId||after?.requestId!==requestId
     ||after.status!=='approved'||after.cancelled!==false
     ||after.activeSession!==true||after.keyPurpose!==lease.keyPurpose
     ||after.kmsKeyId!==lease.kmsKeyId
     ||after.wrappedDataKey!==lease.wrappedDataKey
     ||after.keyVersion!==lease.keyVersion
     ||Date.parse(after.expiresAt??'')<=clock()){
    // Do not leave a decrypted data key reachable after a failed gate.
    bytes.fill(0);
    throw Error('Account export key lease changed during unwrap');
   }
   return bytes;
  },
 });
}
