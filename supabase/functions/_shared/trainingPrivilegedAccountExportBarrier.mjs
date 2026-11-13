/**
 * ALL-251 staged/server-only bridge for the EXISTING account-export writer.
 * Uses the exact same lease acquisition, privileged bytes verification and
 * settlement as workout uploads. The caller must independently verify a live
 * export request/session. Never supply this bridge to browser/mobile code.
 *
 * The callback's original HTTP write is executed exactly once while the
 * durable owner-scoped write lease remains open. Any ambiguous outcome leaves
 * the lease unresolved and deletion blocked.
 */
import {createPrivilegedStorageWriter} from './trainingPrivilegedStorageWriter.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createPrivilegedAccountExportBarrier({serviceClient,leaseAuthority=null}){
 const writer=createPrivilegedStorageWriter({supabase:serviceClient,leaseAuthority});
 return async function withOwnerStorageWriteBarrier({
  ownerId,requestId,bucketId,objectPath,operation,bytes,contentType,write,
 }){
  if(!UUID.test(ownerId??'')||!UUID.test(requestId??'')||
   bucketId!=='v2-private-account-exports'||
   !objectPath?.startsWith(ownerId+'/'+requestId+'/')||
   operation!=='insert'||typeof write!=='function'||
   !(bytes instanceof Uint8Array)||contentType!=='application/octet-stream')
   throw Error('Exact approved private archive write required');
  // Returns a standard Storage upload response expected by the existing
  // canonical paged/archive adapters. It is only minted AFTER DB lease
  // settlement and byte-perfect privileged download readback.
  const result=await writer.writeWithBarrier({
   verifiedOwnerId:ownerId,bucketId,path:objectPath,bytes,
   operation:'create',contentType,upload:write,
  });
  if(result?.verified!==true||result.path!==objectPath)
   throw Error('Privileged export write not independently confirmed');
  return {data:{path:objectPath},error:null};
 };
}
