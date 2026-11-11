/**
 * ALL-251 REVIEW ONLY — a bounded server-side private Storage retrieval adapter
 * for the EXISTING account-export flow. Not an Edge endpoint or deployment.
 *
 * Services are trusted server-only adapters:
 * authorizeExport() must check current Auth user/session, deletion state and
 * exact request ownership; listEvidence() must read the canonical owner tables;
 * downloadPrivateObject() must use a server credential and a fixed private
 * bucket, never a caller-controlled URL. No client bearer/service key here.
 * This stages verified bytes but DOES NOT create or release an archive.
 */
import { verifyTrainingExportObjects } from './v2-training-storage-export-integrity.mjs';

export const TRAINING_EXPORT_MAX_FILES = 128;
export const TRAINING_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

export async function stageTrainingPrivateStorageExport({
  requestId, services, maxFiles = TRAINING_EXPORT_MAX_FILES,
  maxBytes = TRAINING_EXPORT_MAX_BYTES,
}) {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
      || !services || typeof services.authorizeExport !== 'function'
      || typeof services.listEvidence !== 'function'
      || typeof services.downloadPrivateObject !== 'function'
      || maxFiles < 1 || maxFiles > TRAINING_EXPORT_MAX_FILES
      || maxBytes < 1 || maxBytes > TRAINING_EXPORT_MAX_BYTES) {
    throw new Error('Invalid private export configuration');
  }
  // Do not accept an ownerId, bucket, object path, URL, or JWT from a caller.
  const authorization = await services.authorizeExport(requestId);
  const ownerId = authorization?.ownerId;
  if (!authorization?.activeSession || !authorization?.exportPermitted
      || typeof ownerId !== 'string') {
    throw new Error('Private export not authorized');
  }
  const snapshot = await services.listEvidence(ownerId, requestId);
  if (!snapshot || snapshot.ownerId !== ownerId
      || !Array.isArray(snapshot.series) || !Array.isArray(snapshot.routes)) {
    throw new Error('Canonical evidence snapshot missing');
  }
  const rows = [
    ...snapshot.series.map(x => ({ ...x, kind: 'series' })),
    ...snapshot.routes.map(x => ({ ...x, kind: 'route' })),
  ];
  if (rows.length > maxFiles) throw new Error('Private export file count exceeds limit');
  // Preflight the ENTIRE canonical evidence list before the first privileged
  // Storage read. A malicious second record must not trigger partial fetching.
  const seenPaths = new Set();
  for (const row of rows) {
    if (!row || row.user_id !== ownerId || row.state !== 'ready'
        || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.activity_id ?? '')
        || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.source_id ?? '')
        || !/^[0-9a-f]{64}$/.test(row.checksum_sha256 ?? '')
        || (row.kind === 'route' && !['private', 'redacted'].includes(row.privacy_state))
        || typeof row.object_path !== 'string'
        || row.object_path.length < 80 || row.object_path.length > 500
        || !row.object_path.startsWith(ownerId + '/')
        || row.object_path.includes('..') || row.object_path.includes('\\')
        || row.object_path.includes('//') || /[?#%]/.test(row.object_path)
        || seenPaths.has(row.object_path)) {
      throw new Error('Unapproved private evidence object');
    }
    seenPaths.add(row.object_path);
  }
  const fetchedObjects = [];
  let used = 0;
  for (const row of rows) {
    const object = await services.downloadPrivateObject({
      ownerId, requestId, path: row.object_path, kind: row.kind,
    });
    if (!(object instanceof Uint8Array) || object.byteLength === 0
        || used + object.byteLength > maxBytes) {
      throw new Error('Missing or oversized private Storage bytes');
    }
    fetchedObjects.push({ path: row.object_path, bytes: object });
    used += object.byteLength;
  }
  const manifest = verifyTrainingExportObjects({
    ownerId, metadata: rows, fetchedObjects,
  });
  // A revoked Auth session, deleted account or replaced source must invalidate
  // the prepared bytes, even if the initial read was authorized.
  const recheck = await services.authorizeExport(requestId);
  if (!recheck?.activeSession || !recheck?.exportPermitted
      || recheck.ownerId !== ownerId) {
    throw new Error('Private export authorization expired');
  }
  const later = await services.listEvidence(ownerId, requestId);
  // Include the complete security-relevant object identity and evidence
  // state, including source quality, redaction, format, and collection kind.
  // A source becoming untrusted during retrieval must revoke this snapshot.
  const fingerprint = value => JSON.stringify([
    ...value.series.map(x=>['series',x]),
    ...value.routes.map(x=>['route',x]),
  ].map(([kind,x])=>[kind,x.id,x.user_id,x.activity_id,x.source_id,
    x.object_path,x.checksum_sha256,x.state,x.quality,x.privacy_state,
    x.format,x.encoding,x.sample_count,x.point_count,x.starts_at,x.ends_at])
   .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if (!later || later.ownerId !== ownerId
      || !Array.isArray(later.series) || !Array.isArray(later.routes)
      || fingerprint(later) !== fingerprint(snapshot)) {
    throw new Error('Private export evidence changed during retrieval');
  }
  // Optional server-only archive handoff. The caller must provide BOTH
  // durable-write and cleanup adapters: any ambiguous write or expired Auth
  // requires an attempted purge. This never exposes file bytes to mobile.
  let archiveReceipt = null;
  if (services.writeEncryptedArchive !== undefined
      || services.deleteStagedArchive !== undefined) {
    if (typeof services.writeEncryptedArchive !== 'function'
        || typeof services.deleteStagedArchive !== 'function') {
      throw new Error('Archive staging requires both writer and cleanup');
    }
    try {
      const result = await services.writeEncryptedArchive({
        ownerId, requestId, verifiedManifest: manifest,
        files: fetchedObjects,
      });
      if (!result || result.encrypted !== true
          || result.ownerId !== ownerId || result.requestId !== requestId
          || typeof result.archiveId !== 'string' || !result.archiveId
          || result.private !== true
          || typeof result.expiresAt !== 'string'
          || !Number.isFinite(Date.parse(result.expiresAt))
          || Date.parse(result.expiresAt) <= Date.now()
          || Date.parse(result.expiresAt) > Date.now()+24*60*60*1000) {
        throw new Error('Encrypted archive receipt not confirmed');
      }
      archiveReceipt = result;
      // There is an additional authorization window across any durable write.
      const afterWrite = await services.authorizeExport(requestId);
      if (!afterWrite?.activeSession || !afterWrite?.exportPermitted
          || afterWrite.ownerId !== ownerId) {
        throw new Error('Archive authorization expired after write');
      }
      const afterEvidence = await services.listEvidence(ownerId, requestId);
      if (!afterEvidence || afterEvidence.ownerId !== ownerId
          || !Array.isArray(afterEvidence.series)
          || !Array.isArray(afterEvidence.routes)
          || fingerprint(afterEvidence) !== fingerprint(snapshot)) {
        throw new Error('Archive source evidence changed after write');
      }
    } catch (error) {
      // Request-scoped cleanup must be safe even when a write timed out
      // without returning an archive receipt. Never claim cleanup succeeded.
      try { await services.deleteStagedArchive({ownerId, requestId}); }
      catch { throw new Error('Private archive state uncertain; manual cleanup required', {cause:error}); }
      throw error;
    }
  }
  // Archive receipt has only non-secret ID, not a signed URL or bytes.
  // No release action is taken by this stage. The owner workflow must
  // independently authorize archive delivery, TTL and purge.
  return { ...manifest, inspectedBytes: used, readyForArchiveReview: true,
    archiveStaged:archiveReceipt!==null,
    archiveId:archiveReceipt?.archiveId??null,
    completeUserExport: false, storageAuthorizationVerified: false };
}
