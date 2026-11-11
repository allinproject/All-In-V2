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
import {stageTrainingPrivateStorageExport} from './v2-training-private-storage-stage.mjs';

export function createTrainingAccountExportWorkerCandidate({
  bearerToken,authClient,serviceClient,resolveEncryptionKey,
  persistPrivateEnvelope,deletePrivateRequest,
}) {
  if(!serviceClient?.storage?.getBucket||!serviceClient?.from||!serviceClient?.rpc)
    throw new Error('Trusted Supabase service client missing');
  const storageAdapter=createTrainingSupabaseEvidenceAdapter({supabase:serviceClient});
  const archiveSink=createTrainingEncryptedArchiveSink({
    resolveEncryptionKey,persistPrivateEnvelope,deletePrivateRequest,
  });
  const services=createTrainingExportAuthServices({
    bearerToken,authClient,serverClient:serviceClient,
    storageAdapter,archiveSink,
  });
  return Object.freeze({
    async stageApprovedRequest(requestId) {
      // No caller-supplied ownerId, path, bucket, key, archive URL or privileges.
      return stageTrainingPrivateStorageExport({requestId,services});
    },
  });
}
