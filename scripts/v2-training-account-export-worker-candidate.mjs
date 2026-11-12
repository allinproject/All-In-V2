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
  if (canonicalPageReader !== undefined && (
     typeof canonicalPageReader?.getCanonicalInventory !== 'function'
     || typeof canonicalPageReader?.readPage !== 'function'
     || typeof readApprovedRequestExpiry !== 'function')) {
    throw new Error('Large account history needs the canonical page reader and request lease');
  }
  const largeServices = canonicalPageReader === undefined ? null : {
    ...createSupabasePagedAccountExportStorage({
      serviceClient,readApprovedRequestExpiry,
    }),
    authorizeExport: services.authorizeExport,
    getCanonicalInventory: canonicalPageReader.getCanonicalInventory,
    readPage: canonicalPageReader.readPage,
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
      return stageLargeAccountExport({
        requestId,collections:await ownerCollections(requestId),services:largeServices,
      });
    },
    async openApprovedLargeHistoryDownload(requestId) {
      if(!largeServices)throw new Error('Large export source inventory not configured');
      return createLargeAccountDownloadResponse({
        requestId,collections:await ownerCollections(requestId),services:largeServices,
      });
    },
  });
}
