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
const COLUMN_SET = 'id,user_id,activity_id,source_id,object_path,checksum_sha256,state,quality,privacy_state,format,encoding,point_count,sample_count,starts_at,ends_at';

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
      .select(COLUMN_SET,{count:'exact'})
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
    async downloadPrivateObject({ownerId,requestId,path}) {
      checkOwner(ownerId);
      if (!UUID.test(requestId ?? '') || typeof path !== 'string'
        || !path.startsWith(ownerId+'/') || path.length < 80 || path.length > 500
        || path.includes('..') || path.includes('//') || path.includes('\\')
        || /[?#%]/.test(path)) {
        throw new Error('Unsafe private object request');
      }
      await assertPrivateBucket();
      // The caller must have obtained this exact path from listEvidence and
      // verified current authorization. This method alone is NOT an API.
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
