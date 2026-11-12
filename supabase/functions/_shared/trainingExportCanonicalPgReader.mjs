/**
 * ALL-251 REVIEW ONLY: read the EXISTING canonical export's all-domain
 * PostgreSQL candidate through ONE pinned REPEATABLE READ transaction.
 * This is an adapter, not a parallel export endpoint or source of truth.
 *
 * The pool must be a trusted server-only PostgreSQL connection, with no
 * client-supplied SQL and no service password exposed to mobile. The SQL
 * routines enforce the canonical owner, active session, approved request and
 * exact table/Community collection allowlist.
 *
 * The database candidate deliberately returns complete:false while private
 * Storage/Community policy are unapproved; stageLargeAccountExport must refuse
 * to release these pages until those domains have passed their release gates.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTION=/^(?:public|allin_private)\.v2_[a-z0-9_]+$|^auth\.users$|^community\.(?:outgoing_follows|incoming_follow_requests|outgoing_blocks|my_action_receipts)$|^billing\.(?:checkout_attempts|purchases|verified_events)$/;

export function createCanonicalPgAccountReaderCandidate({pool}) {
 if(typeof pool?.connect!=='function')
  throw Error('Trusted private PostgreSQL pool required');
 return Object.freeze({
  async withRepeatableReadSnapshot({ownerId,sessionId,requestId},fn) {
   if(!UUID.test(ownerId??'')||!UUID.test(sessionId??'')
     ||!UUID.test(requestId??'')||typeof fn!=='function')
     throw Error('Verified owner, session, request and operation required');
   const client=await pool.connect();
   if(typeof client?.query!=='function'||typeof client?.release!=='function')
     throw Error('Trusted PostgreSQL connection unavailable');
   let entered=false,closed=false;
   const startedAt=Date.now();
   const maxSnapshotAgeMs=5*60*1000;
   try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    entered=true;
    // Prevent a stalled archive upload from keeping a vacuum-blocking
    // snapshot, lock wait or arbitrary table scan open without bounds.
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '90s'");
    const query=async(statement,args)=>{
     if(closed)throw Error('Export snapshot transaction is closed');
     if(Date.now()-startedAt>maxSnapshotAgeMs)
      throw Error('Canonical export snapshot exceeded maximum staging age');
     const response=await client.query(statement,args);
     const value=response?.rows?.[0]?.payload;
     if(!value||typeof value!=='object'||Array.isArray(value))
      throw Error('Invalid canonical database export response');
     return value;
    };
    const catalogRows=async(statement,args,maxRows)=>{
      if(closed||Date.now()-startedAt>maxSnapshotAgeMs)
        throw Error('Canonical export snapshot is closed or expired');
      const response=await client.query(statement,args);
      if(!Array.isArray(response?.rows)||response.rows.length>maxRows)
        throw Error('Unbounded private Storage catalog query');
      return response.rows;
    };
    const scoped=Object.freeze({
     getCanonicalInventory:async({ownerId:o,requestId:r})=>{
      if(o!==ownerId||r!==requestId)throw Error('Snapshot owner/request mismatch');
      return query('SELECT public.v2_account_export_inventory_review_candidate($1,$2,$3) AS payload',
       [ownerId,sessionId,requestId]);
     },
     // Read-only storage catalog probes share EXACTLY the pinned export
     // transaction; they do not grant Storage access or mint signed URLs.
     listBucketCatalog:async({ownerId:o,requestId:r})=>{
      if(o!==ownerId||r!==requestId)throw Error('Storage catalog owner/request mismatch');
      const rows=await catalogRows(
       'SELECT id, public FROM storage.buckets ORDER BY id LIMIT 129',[],129);
      if(rows.length>128)throw Error('Storage bucket inventory unbounded');
      return rows.map(b=>({id:b.id,public:b.public}));
     },
     listOwnerStorageObjects:async({ownerId:o,requestId:r,bucketId})=>{
      if(o!==ownerId||r!==requestId||bucketId!=='v2-private-workout-objects')
        throw Error('Unreviewed private Storage source');
      const rows=await catalogRows(
       'SELECT name FROM storage.objects WHERE bucket_id=$1 AND name LIKE $2 ORDER BY name LIMIT 129',
       [bucketId,ownerId+'/%'],129);
      if(rows.length>128)throw Error('Owner private media inventory exceeds review bound');
      return {ownerId,requestId,bucketId,exhaustive:true,
       totalCount:rows.length,paths:rows.map(x=>x.name)};
     },
     listCanonicalMediaReferences:async({ownerId:o,requestId:r})=>{
      if(o!==ownerId||r!==requestId)throw Error('Media reference owner/request mismatch');
      const rows=await catalogRows(
       "SELECT 'series' AS kind,user_id,object_path,checksum_sha256,state,NULL::text AS privacy_state FROM public.v2_activity_series WHERE user_id=$1 UNION ALL SELECT 'route' AS kind,user_id,object_path,checksum_sha256,state,privacy_state FROM public.v2_activity_route_objects WHERE user_id=$1 ORDER BY kind,object_path LIMIT 129",
       [ownerId],129);
      if(rows.length>128)throw Error('Owner media references exceed review bound');
      return {ownerId,requestId,series:rows.filter(x=>x.kind==='series'),
       routes:rows.filter(x=>x.kind==='route')};
     },
     readPage:async({ownerId:o,requestId:r,collection,cursor,limit})=>{
      if(o!==ownerId||r!==requestId||!COLLECTION.test(collection??'')
       ||!(cursor===null||typeof cursor==='string')
       ||!Number.isInteger(limit)||limit<1)
       throw Error('Invalid canonical PostgreSQL page request');
      return query('SELECT public.v2_account_export_page_review_candidate($1,$2,$3,$4,$5,$6) AS payload',
       [ownerId,sessionId,requestId,collection,cursor,Math.min(limit,25)]);
     },
    });
    const result=await fn(scoped);
    if(Date.now()-startedAt>maxSnapshotAgeMs)
      throw Error('Canonical export snapshot exceeded maximum staging age');
    closed=true;
    await client.query('COMMIT');
    return result;
   }catch(error){
    closed=true;
    if(entered)try{await client.query('ROLLBACK');}catch{
     throw Error('Canonical export snapshot rollback uncertain',{cause:error});
    }
    throw error;
   }finally {
    closed=true;
    client.release();
   }
  },
 });
}
