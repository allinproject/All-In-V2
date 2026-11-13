/**
 * ALL-230 review-only server adapter for canonical Training restriction source
 * ingestion. NOT an endpoint, deployment, certification writer or source of truth.
 *
 * Four externally supplied source readers MUST be trusted database readers operating on the
 * same pinned transaction. An external API, client, Coach summary or fabricated
 * empty inventory is never an acceptable source reader.
 */
import {createHash} from 'node:crypto';

export const TRAINING_RESTRICTION_SOURCES=Object.freeze([
 'current_restrictions','approved_plans','historical_records',
 'imported_records','restored_records',
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32=/^[0-9a-f]{32}$/;
const keySort=(value)=>{
 if(Array.isArray(value))return value.map(keySort);
 if(value&&typeof value==='object')
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,keySort(value[k])]));
 return value;
};
const digest=(value)=>createHash('sha256').update(JSON.stringify(keySort(value))).digest('hex');
const count=v=>Number.isSafeInteger(v)&&v>=0;

/**
 * authenticateSession must verify a signed token through Supabase Auth, return
 * ownerId/sessionId, and must not derive identity from unverified client data.
 * Source readers must be explicitly supplied by the trusted Training owner.
 * The current restriction source is fixed to the canonical Training table.
 * Each reader returns all canonical source rows, with independently verified
 * exhaustive flag and snapshotVersion from this SAME database transaction.
 * reconcileSource is trusted owner logic, not an LLM or client callback. It
 * returns {reconciledCount,unresolvedCount} and must inspect EVERY source row.
 */
export function createTrainingRestrictionSourceReaderCandidate({
 pool,authenticateSession,sourceReaders,reconcileSource,
}) {
 if(typeof pool?.connect!=='function'||typeof authenticateSession!=='function'
   ||typeof reconcileSource!=='function'
   ||!sourceReaders||TRAINING_RESTRICTION_SOURCES.slice(1).some(k=>typeof sourceReaders[k]!=='function')
   ||Object.keys(sourceReaders).some(k=>!TRAINING_RESTRICTION_SOURCES.slice(1).includes(k)))
  throw Error('All trusted Training source readers and Auth/reconciliation services required');
 return Object.freeze({
  async ingestReviewedSources({bearerToken,snapshotVersion}) {
   if(typeof snapshotVersion!=='string'||!snapshotVersion.trim()
      ||snapshotVersion.length>160)throw Error('Exact Training snapshot required');
   const verified=await authenticateSession(bearerToken);
   if(!UUID.test(verified?.ownerId??'')||!UUID.test(verified?.sessionId??''))
    throw Error('Verified Training Auth owner and session required');
   const {ownerId,sessionId}=verified;
   const client=await pool.connect();
   if(typeof client?.query!=='function'||typeof client?.release!=='function')
    throw Error('Trusted Training database transaction required');
   let entered=false;
   try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    entered=true;
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '90s'");
    // The session claim is populated only AFTER signed-token verification.
    // The DB ingestion routine independently checks auth.sessions and owner.
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.session_id',$1,true)",[sessionId]);
    const baseline=await client.query(
     'SELECT allin_private.v2_training_restriction_inventory_digest_candidate($1) AS digest',
     [ownerId]);
    const canonicalDigest=baseline?.rows?.[0]?.digest;
    if(!HEX32.test(canonicalDigest??''))
     throw Error('Canonical restriction inventory unavailable');
    const evidence=[];
    for(const kind of TRAINING_RESTRICTION_SOURCES) {
     const reader=kind==='current_restrictions'
      ?readCanonicalCurrentRestrictionSource:sourceReaders[kind];
     const raw=await reader({client,ownerId,sessionId,snapshotVersion});
     if(raw?.ownerId!==ownerId||raw?.snapshotVersion!==snapshotVersion
        ||raw?.exhaustive!==true||raw?.nextCursor!==null
        ||!Array.isArray(raw?.records)||!raw?.evidenceRef
        ||typeof raw.evidenceRef!=='string'||raw.evidenceRef.trim().length===0
        ||raw.evidenceRef.length>200)
      throw Error('Source reader did not prove complete owner-bound snapshot: '+kind);
     if(raw.records.some(row=>row===null||typeof row!=='object'||Array.isArray(row)
        ||row.user_id!==ownerId))
      throw Error('Source reader returned foreign/malformed owner record: '+kind);
     const accounting=await reconcileSource({
      client,ownerId,sessionId,snapshotVersion,kind,records:raw.records,
     });
     if(!count(accounting?.reconciledCount)||!count(accounting?.unresolvedCount)
        ||accounting.reconciledCount!==raw.records.length
        ||accounting.unresolvedCount!==0)
      throw Error('Unresolved source provenance or canonical mapping: '+kind);
     evidence.push({
      kind,ownerId,snapshotVersion,evidenceRef:raw.evidenceRef,
      inventoryDigest:digest(raw.records),
      canonicalInventoryDigest:canonicalDigest,
      inspectedCount:raw.records.length,reconciledCount:accounting.reconciledCount,
      unresolvedCount:0,complete:true,nextCursor:null,
     });
    }
    if(new Set(evidence.map(s=>s.evidenceRef)).size!==evidence.length)
     throw Error('Source evidence identity reused');
    const check=await client.query(
     'SELECT allin_private.v2_training_ingest_restriction_source_evidence_candidate($1,$2,$3::jsonb) AS payload',
     [ownerId,snapshotVersion,JSON.stringify(evidence)]);
    const result=check?.rows?.[0]?.payload;
    if(result?.ownerId!==ownerId||result?.snapshotVersion!==snapshotVersion
       ||result?.status!=='review_required'
       ||result?.initialCertificationAuthorized!==false
       ||result?.sourceAuthenticityEstablished!==false
       ||result?.recordedInventoryDigest!==canonicalDigest)
     throw Error('Unapproved Training ingestion receipt');
    await client.query('COMMIT');
    return result;
   }catch(error){
    if(entered)try{await client.query('ROLLBACK');}
    catch{throw Error('Training source ingestion rollback uncertain',{cause:error});}
    throw error;
   }finally{client.release();}
  },
 });
}

/**
 * Concrete canonical Training-owned current restriction source. It reads
 * active AND retired rows from the SAME transaction used by the ingest RPC.
 * The bound LIMIT + 1 is a fail-closed cap, not silently truncated coverage.
 * The remaining four source kinds still need their authoritative readers.
 */
export async function readCanonicalCurrentRestrictionSource({
 client,ownerId,snapshotVersion,
}) {
 if(typeof client?.query!=='function'||!UUID.test(ownerId??'')
   ||typeof snapshotVersion!=='string'||!snapshotVersion.trim())
  throw Error('Pinned canonical Training source transaction required');
 const response=await client.query(
  'SELECT * FROM public.v2_training_athlete_restrictions WHERE user_id=$1 ORDER BY id LIMIT 201',
  [ownerId]);
 if(!Array.isArray(response?.rows)||response.rows.length>200)
  throw Error('Canonical restriction source is unbounded or unavailable');
 if(response.rows.some(row=>row?.user_id!==ownerId))
  throw Error('Canonical restriction query returned foreign owner');
 return {
  ownerId,snapshotVersion,exhaustive:true,nextCursor:null,
  evidenceRef:'training-canonical:'+snapshotVersion+':current',
  records:response.rows,
 };
}
