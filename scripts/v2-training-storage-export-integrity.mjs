/**
 * ALL-251 REVIEW-ONLY: offline verifier for private Training/Activity file export.
 * Pure Node fixture code, NOT an Edge Function, Storage reader or public API.
 * Caller must provide bytes fetched by a separately authenticated owner-safe
 * backend. No signed URLs, path enumeration, or client-provided owner authority.
 */
import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['series', 'route']);

export function verifyTrainingExportObjects({ ownerId, metadata, fetchedObjects }) {
  if (!UUID.test(ownerId ?? '') || !Array.isArray(metadata) || !Array.isArray(fetchedObjects)) {
    throw new Error('Incomplete private export inputs');
  }
  const seen = new Set();
  const supplied = new Map();
  for (const object of fetchedObjects) {
    if (!object || typeof object.path !== 'string' || !(object.bytes instanceof Uint8Array)
        || supplied.has(object.path)) throw new Error('Duplicate or invalid fetched object');
    supplied.set(object.path, object.bytes);
  }
  const files = [];
  for (const record of metadata) {
    if (!record || record.user_id !== ownerId || !KINDS.has(record.kind)
        || !UUID.test(record.activity_id ?? '') || !UUID.test(record.source_id ?? '')
        || record.state !== 'ready' || (record.kind === 'route'
           && !['private','redacted'].includes(record.privacy_state))) {
      throw new Error('Unreviewed or foreign owner export object');
    }
    const path = record.object_path;
    if (typeof path !== 'string' || !path.startsWith(ownerId + '/')
        || path.includes('..') || path.includes('//') || path.includes('\\')
        || path.length > 500 || path.length < 80 || /[?#%]/.test(path)
        || seen.has(path) || !SHA256.test(record.checksum_sha256 ?? '')) {
      throw new Error('Invalid or repeated private export object identity');
    }
    seen.add(path);
    const bytes = supplied.get(path);
    if (!bytes || bytes.byteLength === 0) throw new Error('Missing private export object bytes');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== record.checksum_sha256) throw new Error('Private export file checksum mismatch');
    files.push({
      kind: record.kind, activityId: record.activity_id, sourceId: record.source_id,
      objectPath: path, checksumSha256: actual, byteLength: bytes.byteLength,
    });
  }
  if (supplied.size !== seen.size) throw new Error('Unlisted private object supplied');
  return Object.freeze({
    version: 'v2-training-storage-export-integrity-v1',
    ownerId, verifiedFileCount: files.length, files,
    completeUserExport: false,
    storageAuthorizationVerified: false,
  });
}
