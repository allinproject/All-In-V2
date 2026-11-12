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
const COLLECTION=/^(?:public|allin_private)\.v2_[a-z0-9_]+$|^auth\.users$|^community\.(?:outgoing_follows|incoming_follow_requests|outgoing_blocks|my_action_receipts)$/;

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
   try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    entered=true;
    const query=async(statement,args)=>{
     if(closed)throw Error('Export snapshot transaction is closed');
     const response=await client.query(statement,args);
     const value=response?.rows?.[0]?.payload;
     if(!value||typeof value!=='object'||Array.isArray(value))
      throw Error('Invalid canonical database export response');
     return value;
    };
    const scoped=Object.freeze({
     getCanonicalInventory:async({ownerId:o,requestId:r})=>{
      if(o!==ownerId||r!==requestId)throw Error('Snapshot owner/request mismatch');
      return query('SELECT public.v2_account_export_inventory_review_candidate($1,$2,$3) AS payload',
       [ownerId,sessionId,requestId]);
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
