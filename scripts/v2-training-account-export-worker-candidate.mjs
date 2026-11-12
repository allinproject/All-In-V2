/**
 * ALL-251 REVIEW ONLY: compose EXISTING account-export worker dependencies.
 * No new public endpoint, no deployment, no service-role credentials in code.
 * The original Profile account-export operation remains the owning workflow.
 *
 * Call only from a trusted server with an Auth-verified bearer token, a
 * service-role Supabase client, KMS key adapter and private expiring archive
 * persistence. Service-only Auth/request RPC remains DEFAULT OFF until review.
 */
import {createTrainingExportAuthServices} from '../supabase/functions/_shared/trainingExportAuthServices.mjs';
import {createTrainingSupabaseEvidenceAdapter} from '../supabase/functions/_shared/trainingExportSupabaseStorage.mjs';
import {createTrainingEncryptedArchiveSink} from './v2-training-export-archive-writer.mjs';
import {createSupabasePrivateArchivePersistence,createSupabasePagedAccountExportStorage} from '../supabase/functions/_shared/trainingExportSupabaseArchive.mjs';
import {stageLargeAccountExport,createLargeAccountDownloadResponse} from '../supabase/functions/_shared/trainingExportLargeArchive.mjs';
import {stageTrainingPrivateStorageExport} from './v2-training-private-storage-stage.mjs';

export function createTrainingAccountExportWorkerCandidate({
  bearerToken,authClient,serviceClient,resolveEncryptionKey,
  persistPrivateEnvelope,deletePrivateRequest,readApprovedRequestExpiry,
  canonicalPageReader,
}) {
  if(!serviceClient?.storage?.getBucket||!serviceClient?.from||!serviceClient?.rpc)
    throw new Error('Trusted Supabase service client missing');
  const storageAdapter=createTrainingSupabaseEvidenceAdapter({supabase:serviceClient});
  // One owning ALL-251 flow: either explicit trusted persistence adapters,
  // or the fixed Supabase private archive adapter with an independently
  // approved owner/session/request lease. Never use an anonymous fallback.
  const hasSupabaseLease=typeof readApprovedRequestExpiry==='function';
  if(hasSupabaseLease&&(persistPrivateEnvelope!==undefined
     ||deletePrivateRequest!==undefined)) {
    throw new Error('Conflicting private archive persistence sources');
  }
  const persistence=hasSupabaseLease
    ?createSupabasePrivateArchivePersistence({
      serviceClient,readApprovedRequestExpiry,
     })
    :{persistPrivateEnvelope,deletePrivateRequest};
  const archiveSink=createTrainingEncryptedArchiveSink({
    resolveEncryptionKey,...persistence,
  });
  const services=createTrainingExportAuthServices({
    bearerToken,authClient,serverClient:serviceClient,
    storageAdapter,archiveSink,
  });
  // Optional large-history capability remains owned by this SAME ALL-251
  // worker. It is unusable until a reviewed canonical page-reader implements
  // all private/public source inventories and stable data snapshots.
  const pinnedReader = typeof canonicalPageReader?.withRepeatableReadSnapshot === 'function';
  if (canonicalPageReader !== undefined && (
     (!pinnedReader && (typeof canonicalPageReader?.getCanonicalInventory !== 'function'
       || typeof canonicalPageReader?.readPage !== 'function'))
     || typeof readApprovedRequestExpiry !== 'function')) {
    throw new Error('Large account history needs the canonical page reader and request lease');
  }
  const largeServices = canonicalPageReader === undefined ? null : {
    ...createSupabasePagedAccountExportStorage({
      serviceClient,readApprovedRequestExpiry,
    }),
    authorizeExport: services.authorizeExport,
    getCanonicalInventory: pinnedReader
      ? async () => {throw new Error('Pinned export snapshot must be active');}
      : canonicalPageReader.getCanonicalInventory,
    readPage: pinnedReader
      ? async () => {throw new Error('Pinned export snapshot must be active');}
      : canonicalPageReader.readPage,
    resolveEncryptionKey,
  };
  async function ownerCollections(requestId) {
    const gate = await services.authorizeExport(requestId);
    const inventory = await largeServices.getCanonicalInventory({
      ownerId:gate.ownerId,requestId,
    });
    if(inventory?.ownerId!==gate.ownerId||inventory.requestId!==requestId
       ||inventory.complete!==true||!Array.isArray(inventory.collections)) {
      throw new Error('Unapproved canonical account inventory');
    }
    return inventory.collections;
  }
  return Object.freeze({
    async stageApprovedRequest(requestId) {
      // No caller-supplied ownerId, path, bucket, key, archive URL or privileges.
      return stageTrainingPrivateStorageExport({requestId,services});
    },
    async stageApprovedLargeHistory(requestId) {
      if(!largeServices)throw new Error('Large export source inventory not configured');
      if(!pinnedReader) {
        return stageLargeAccountExport({
          requestId,collections:await ownerCollections(requestId),services:largeServices,
        });
      }
      const gate=await services.authorizeExport(requestId);
      if(!gate?.sessionId)throw new Error('Verified export session missing');
      // The actual canonical SQL inventory and every page must share ONE
      // repeatable-read snapshot. An independent REST RPC per page is unsafe.
      let archiveCommitted=false;
      try {
        const receipt=await canonicalPageReader.withRepeatableReadSnapshot({
          ownerId:gate.ownerId,sessionId:gate.sessionId,requestId,
        },async scoped=>{
          const inventory=await scoped.getCanonicalInventory({
            ownerId:gate.ownerId,requestId,
          });
          if(inventory?.complete!==true||inventory?.ownerId!==gate.ownerId
            ||inventory?.requestId!==requestId
            ||!Array.isArray(inventory.collections)) {
            throw new Error('Canonical export source coverage or privacy review incomplete');
          }
          const result=await stageLargeAccountExport({
            requestId,collections:inventory.collections,
            services:{...largeServices,
              getCanonicalInventory:scoped.getCanonicalInventory,
              readPage:scoped.readPage,
            },
          });
          // The encrypted manifest is written before the database commit.
          // A failed COMMIT must not leave a releasable complete archive.
          archiveCommitted=true;
          return result;
        });
        // A revoked session immediately after the snapshot COMMIT must not
        // leave an archive reported as available to the account holder.
        const finalGate=await services.authorizeExport(requestId);
        if(finalGate.ownerId!==gate.ownerId||finalGate.sessionId!==gate.sessionId)
          throw new Error('Export session changed after staging');
        return receipt;
      }catch(error){
        if(archiveCommitted){
          try {
            if(await largeServices.purgePrivateRequest({
              ownerId:gate.ownerId,requestId,
            })!==true)throw new Error('Archive removal unconfirmed');
          }catch{
            throw new Error('Export snapshot failed; private archive cleanup unresolved',
              {cause:error});
          }
        }
        throw error;
      }
    },
    async openApprovedLargeHistoryDownload(requestId) {
      if(!largeServices)throw new Error('Large export source inventory not configured');
      if(!pinnedReader) {
        return createLargeAccountDownloadResponse({
          requestId,collections:await ownerCollections(requestId),services:largeServices,
        });
      }
      // The encrypted manifest is the immutable data snapshot AFTER staging.
      // A fresh read from mutable production tables would change snapshot IDs.
      // Current Auth and durable request authorization still run on every page.
      const gate=await services.authorizeExport(requestId);
      const manifest=await largeServices.readPrivateManifest({
        ownerId:gate.ownerId,requestId,
      });
      if(manifest?.ownerId!==gate.ownerId||manifest?.requestId!==requestId
        ||manifest.completeUserExport!==true
        ||typeof manifest.snapshotId!=='string'
        ||!Array.isArray(manifest.collections)) {
        throw new Error('Approved immutable account export manifest unavailable');
      }
      const frozenInventory=async({ownerId,requestId:requested})=>{
        if(ownerId!==gate.ownerId||requested!==requestId)
          throw new Error('Export manifest owner mismatch');
        return {ownerId,requestId,complete:true,
          snapshotId:manifest.snapshotId,collections:manifest.collections};
      };
      return createLargeAccountDownloadResponse({
        requestId,collections:manifest.collections,
        services:{...largeServices,getCanonicalInventory:frozenInventory},
      });
    },
  });
}
