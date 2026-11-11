/**
 * ALL-251 REVIEW ONLY — trusted encrypted archive sink for existing export.
 * No deployed bucket, public endpoint or signed download URL.
 * Service implementations must use an authenticated, private, expiring
 * archive store and a server-only KMS-managed 32-byte AES key per request.
 */
import { encryptVerifiedTrainingExport } from './v2-training-encrypted-export-envelope.mjs';

export function createTrainingEncryptedArchiveSink({
  resolveEncryptionKey, persistPrivateEnvelope, deletePrivateRequest,
}) {
  if (typeof resolveEncryptionKey!=='function'
    || typeof persistPrivateEnvelope!=='function'
    || typeof deletePrivateRequest!=='function') {
    throw new Error('Trusted archive sink requires key, persistence and deletion adapters');
  }
  return Object.freeze({
    async writeEncryptedArchive({ownerId,requestId,verifiedManifest,files}) {
      const encryptionKey=await resolveEncryptionKey({ownerId,requestId});
      const envelope=encryptVerifiedTrainingExport({
        ownerId,requestId,verifiedManifest,files,encryptionKey,
      });
      // Never persist the key, include it in metadata or return it to client.
      const saved=await persistPrivateEnvelope({ownerId,requestId,envelope});
      if (!saved || typeof saved.archiveId!=='string' || !saved.archiveId
        || saved.ownerId!==ownerId || saved.requestId!==requestId
        || saved.encrypted!==true || saved.private!==true
        || saved.expiresAt===undefined) {
        throw new Error('Durable private encrypted archive receipt missing');
      }
      const expires=Date.parse(saved.expiresAt);
      if(!Number.isFinite(expires)||expires<=Date.now()) {
        throw new Error('Encrypted archive expiry is invalid');
      }
      return {ownerId,requestId,archiveId:saved.archiveId,encrypted:true};
    },
    async deleteStagedArchive({ownerId,requestId}) {
      // Cleanup keyed by owner+request, not by a possibly lost receipt ID.
      const deleted=await deletePrivateRequest({ownerId,requestId});
      if (deleted!==true) throw new Error('Archive cleanup not confirmed');
    },
  });
}
