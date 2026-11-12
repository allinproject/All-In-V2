/**
 * ALL-251 REVIEW ONLY: trusted Supabase adapter for the existing private
 * account-export staging workflow. NOT a deployed Edge endpoint.
 *
 * The Supabase client must be constructed server-side with a privileged key.
 * Never import this module from mobile/web, accept caller-owned paths,
 * or use it without an independently verified live Auth session and export
 * request authorization. It does not mint signed URLs or publish files.
 */
export const TRAINING_PRIVATE_EVIDENCE_BUCKET = 'v2-private-workout-objects';
const MAX_OBJECTS = 128;
const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const COLUMNS = Object.freeze({
  series:'id,user_id,activity_id,source_id,object_path,checksum_sha256,state,quality,encoding,sample_count,starts_at,ends_at',
  route:'id,user_id,activity_id,source_id,object_path,checksum_sha256,state,quality,privacy_state,format,point_count',
});

function checkOwner(ownerId) {
  if (typeof ownerId !== 'string' || !UUID.test(ownerId)) {
    throw new Error('Trusted export owner required');
  }
}
function validRow(row,ownerId,kind) {
  return row && row.user_id === ownerId && UUID.test(row.id ?? '')
    && UUID.test(row.activity_id ?? '') && UUID.test(row.source_id ?? '')
    && SHA.test(row.checksum_sha256 ?? '')
    && row.state === 'ready'
    && (kind !== 'route' || ['private','redacted'].includes(row.privacy_state))
    && typeof row.object_path === 'string'
    && row.object_path.startsWith(ownerId + '/')
    && row.object_path.length >= 80 && row.object_path.length <= 500
    && !row.object_path.includes('..') && !row.object_path.includes('//')
    && !row.object_path.includes('\\') && !/[?#%]/.test(row.object_path);
}
export function createTrainingSupabaseEvidenceAdapter({ supabase }) {
  if (!supabase?.from || !supabase?.storage?.from || !supabase?.storage?.getBucket) {
    throw new Error('Server-only Supabase adapter required');
  }
  async function assertPrivateBucket() {
    const {data,error} = await supabase.storage.getBucket(TRAINING_PRIVATE_EVIDENCE_BUCKET);
    if (error || data?.id !== TRAINING_PRIVATE_EVIDENCE_BUCKET || data?.public !== false) {
      throw new Error('Private workout Storage bucket unavailable or public');
    }
  }
  async function getRows(table,ownerId,kind) {
    const response = await supabase.from(table)
      .select(COLUMNS[kind],{count:'exact'})
      .eq('user_id',ownerId).order('id',{ascending:true}).range(0,MAX_OBJECTS);
    if (response?.error || !Array.isArray(response?.data)
      || !Number.isInteger(response?.count)
      || response.count !== response.data.length
      || response.count > MAX_OBJECTS) {
      throw new Error('Owner evidence query missing or truncated');
    }
    // A non-ready record cannot be silently omitted from a completed export.
    if (!response.data.every(row => validRow(row,ownerId,kind))) {
      throw new Error('Invalid or unreviewed canonical evidence');
    }
    return response.data;
  }
  return Object.freeze({
    async listEvidence(ownerId,requestId) {
      checkOwner(ownerId);
      if (!UUID.test(requestId ?? '')) throw new Error('Trusted export request required');
      await assertPrivateBucket();
      const series = await getRows('v2_activity_series',ownerId,'series');
      const routes = await getRows('v2_activity_route_objects',ownerId,'route');
      if (series.length + routes.length > MAX_OBJECTS) {
        throw new Error('Too many owner evidence objects');
      }
      const paths = [...series,...routes].map(r=>r.object_path);
      if (new Set(paths).size !== paths.length) {
        throw new Error('Duplicate private object paths');
      }
      return {ownerId,series,routes};
    },
    async downloadPrivateObject({ownerId,requestId,path,kind}) {
      checkOwner(ownerId);
      if (!UUID.test(requestId ?? '') || typeof path !== 'string'
        || !path.startsWith(ownerId+'/') || path.length < 80 || path.length > 500
        || path.includes('..') || path.includes('//') || path.includes('\\')
        || /[?#%]/.test(path)) {
        throw new Error('Unsafe private object request');
      }
      if (!['series','route'].includes(kind)) {
        throw new Error('Explicit evidence kind required');
      }
      // Re-read the exact canonical owner+path row immediately before using
      // elevated Storage rights. The adapter cannot be used to download an
      // arbitrary owner-prefixed private object, even by its internal caller.
      const table = kind === 'series' ? 'v2_activity_series' : 'v2_activity_route_objects';
      const proof = await supabase.from(table).select(COLUMNS[kind])
        .eq('user_id',ownerId).eq('object_path',path).maybeSingle();
      if (proof?.error || !validRow(proof?.data,ownerId,kind)
          || proof.data.object_path !== path) {
        throw new Error('Private object is not approved canonical evidence');
      }
      await assertPrivateBucket();
      const {data,error}=await supabase.storage
        .from(TRAINING_PRIVATE_EVIDENCE_BUCKET).download(path);
      if (error || !data || typeof data.arrayBuffer !== 'function') {
        throw new Error('Private Storage object absent');
      }
      if (typeof data.size === 'number' && data.size > MAX_OBJECT_BYTES) {
        throw new Error('Private Storage object exceeds limit');
      }
      const binary=new Uint8Array(await data.arrayBuffer());
      if (!binary.byteLength || binary.byteLength>MAX_OBJECT_BYTES) {
        throw new Error('Private Storage object missing or oversized');
      }
      return binary;
    },
  });
}

/**
 * ALL-251 REVIEW ONLY: reconcile actual owner-owned private Storage object
 * identity against the EXISTING canonical activity-series/route references.
 * The privileged enumerators must be backed by an exhaustive, consistent
 * Storage catalog query; ordinary one-directory Storage.list is not enough.
 *
 * This is a coverage diagnostic, not a downloadable archive or release gate
 * approval. Future media/photo buckets MUST be explicitly classified rather
 * than silently omitted. No Storage or authentication permissions are changed.
 */
export async function auditOwnerPrivateMediaCoverage({
  ownerId,requestId,evidenceAdapter,listBucketCatalog,listOwnerStorageObjects,
}) {
  checkOwner(ownerId);
  if(!UUID.test(requestId??'')
    ||typeof evidenceAdapter?.listEvidence!=='function'
    ||typeof listBucketCatalog!=='function'
    ||typeof listOwnerStorageObjects!=='function')
    throw Error('Trusted exhaustive Storage coverage dependencies required');
  const buckets=await listBucketCatalog();
  if(!Array.isArray(buckets)||buckets.some(b=>!b||typeof b.id!=='string'
      ||typeof b.public!=='boolean')||new Set(buckets.map(b=>b.id)).size!==buckets.length)
    throw Error('Unverified Storage bucket inventory');
  const approved=new Set([TRAINING_PRIVATE_EVIDENCE_BUCKET,'v2-private-account-exports']);
  if(buckets.some(b=>b.public||!approved.has(b.id)))
    throw Error('Unreviewed or public Storage bucket requires media export classification');
  const hasWorkout=buckets.some(b=>b.id===TRAINING_PRIVATE_EVIDENCE_BUCKET);
  if(!hasWorkout)
    throw Error('Canonical private workout bucket missing from coverage audit');
  // Private account-export archives are generated output, NOT source media.
  // Their separate retention/purge acceptance remains independently required.
  const evidence=await evidenceAdapter.listEvidence(ownerId,requestId);
  if(evidence?.ownerId!==ownerId||!Array.isArray(evidence.series)
    ||!Array.isArray(evidence.routes))
    throw Error('Canonical private evidence owner mismatch');
  const sources=[...evidence.series,...evidence.routes];
  if(sources.length>MAX_OBJECTS)throw Error('Canonical owner media object limit exceeded');
  const expected=new Set();
  for(const row of sources){
    if(row?.user_id!==ownerId||typeof row?.object_path!=='string'
      ||!row.object_path.startsWith(ownerId+'/')||!SHA.test(row.checksum_sha256??'')
      ||expected.has(row.object_path))
      throw Error('Invalid or duplicated canonical media reference');
    expected.add(row.object_path);
  }
  const observed=await listOwnerStorageObjects({
    ownerId,requestId,bucketId:TRAINING_PRIVATE_EVIDENCE_BUCKET,
  });
  if(observed?.ownerId!==ownerId
    ||observed?.bucketId!==TRAINING_PRIVATE_EVIDENCE_BUCKET
    ||observed?.exhaustive!==true
    ||!Number.isSafeInteger(observed.totalCount)
    ||observed.totalCount<0
    ||!Array.isArray(observed.paths)
    ||observed.paths.length!==observed.totalCount
    ||observed.paths.length>MAX_OBJECTS)
    throw Error('Storage inventory incomplete or unbounded');
  const seen=new Set();
  for(const path of observed.paths){
    if(typeof path!=='string'||!path.startsWith(ownerId+'/')
      ||path.includes('..')||path.includes('//')||path.includes('\\')
      ||seen.has(path)||!expected.has(path))
      throw Error('Unreferenced, foreign or duplicate private media object');
    seen.add(path);
  }
  if(seen.size!==expected.size)
    throw Error('Canonical media reference has no corresponding Storage object');
  return Object.freeze({
    ownerId,requestId,referencedObjects:expected.size,
    observedObjects:seen.size,sourceBuckets:[TRAINING_PRIVATE_EVIDENCE_BUCKET],
    exportArchiveBucketPresent:buckets.some(b=>b.id==='v2-private-account-exports'),
    referencesReconciled:true,
    bytesVerified:false,completeUserExport:false,
  });
}
