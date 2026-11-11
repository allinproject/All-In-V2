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
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)
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
  const fetchedObjects = [];
  let used = 0;
  for (const row of rows) {
    // Prevalidate metadata before even touching privileged private Storage.
    // The integrity verifier validates each path and owner again after fetch.
    if (!row || row.user_id !== ownerId || row.state !== 'ready'
        || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.activity_id ?? '')
        || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.source_id ?? '')
        || !/^[0-9a-f]{64}$/.test(row.checksum_sha256 ?? '')
        || (row.kind === 'route' && !['private', 'redacted'].includes(row.privacy_state))
        || typeof row.object_path !== 'string'
        || row.object_path.length < 80 || row.object_path.length > 500
        || !row.object_path.startsWith(ownerId + '/')
        || row.object_path.includes('..') || row.object_path.includes('\\')
        || row.object_path.includes('//') || /[?#%]/.test(row.object_path)) {
      throw new Error('Unapproved private evidence object');
    }
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
  const fingerprint = value => JSON.stringify([...value.series, ...value.routes]
      .map(x => [x.id, x.user_id, x.activity_id, x.source_id,
        x.object_path, x.checksum_sha256, x.state, x.privacy_state])
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if (!later || later.ownerId !== ownerId
      || !Array.isArray(later.series) || !Array.isArray(later.routes)
      || fingerprint(later) !== fingerprint(snapshot)) {
    throw new Error('Private export evidence changed during retrieval');
  }
  // Byte data is intentionally NOT returned to the mobile client or stored.
  // An eventual bounded archive worker must own lifecycle/cleanup separately.
  return { ...manifest, inspectedBytes: used, readyForArchiveReview: true,
    completeUserExport: false, storageAuthorizationVerified: false };
}
