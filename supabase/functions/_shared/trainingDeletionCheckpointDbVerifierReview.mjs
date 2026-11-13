/**
 * ALL-251 REVIEW ONLY. Server-only Supabase service-role client adapter for
 * the candidate PostgreSQL checkpoint verifier. Not imported by the live
 * deletion worker or exposed to mobile clients. Does not enable deletion.
 *
 * Database RPC must itself restrict EXECUTE to service_role and validate the
 * canonical deletion execution audit, immutable plan and every checkpoint.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET=/^[a-z0-9][a-z0-9-]{1,80}$/;
export function createDeletionCheckpointDatabaseReviewAdapter({supabase}) {
 if(!supabase || typeof supabase.rpc!=='function')
  throw Error('Trusted Supabase service-only RPC client required');
 return Object.freeze({
  async verifyBucketCheckpoints({ownerId,requestId,bucketId,plannedCount}) {
   if(!UUID.test(ownerId??'')||!UUID.test(requestId??'') ||
      !BUCKET.test(bucketId??'') || !Number.isSafeInteger(plannedCount) ||
      plannedCount<0||plannedCount>10000)
    throw Error('Exact deletion checkpoint verification scope required');
   const {data,error}=await supabase.rpc('v2_review_account_deletion_bucket_checkpoints',{
    p_expected_owner_id:ownerId,p_expected_request_id:requestId,
    p_bucket_id:bucketId,p_expected_count:plannedCount,
   });
   if(error || typeof data!=='boolean')
    throw Error('Database deletion checkpoint verification unavailable');
   return data===true;
  },
 });
}
