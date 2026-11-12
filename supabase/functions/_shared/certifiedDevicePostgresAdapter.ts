/** ALL-243 REVIEW ONLY: server-owned PostgreSQL bridge. NOT a public API.
 * Requires a dedicated DB operator login with SELECT on auth.users/sessions
 * and the registered-source table, plus SET ROLE to NOLOGIN
 * allin_v2_device_ingest. NEVER use a client key or expose the DB password.
 * The operator must not be postgres/superuser/BYPASSRLS.
 */
import {sourceIdentityKey,type ActivitySourceIdentity} from
 '../../../apps/mobile-v2/src/features/training/completedActivitySourceReconciliation.ts';
import type {CanonicalMetricAppend} from
 '../../../apps/mobile-v2/src/features/training/trustedDeviceMetricBoundary.ts';
import type {AuthenticatedCanonicalIngestBackend,CanonicalIngestTransaction,
 VerifiedAthleteSession} from './certifiedDeviceIngestServer.ts';

type Row=Record<string,unknown>;
export type QueryClient={unsafe:(sql:string,params?:readonly unknown[])=>
 Promise<readonly Row[]>};
export type TransactionalSql={begin:<T>(fn:(tx:QueryClient)=>Promise<T>)=>Promise<T>};
type AuthVerifier={getUser:(token:string)=>Promise<{id:string}|null>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const safe=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=500;
const validNow=(n:number)=>Number.isSafeInteger(n)&&n>0;
const first=(rows:readonly Row[])=>rows[0]??null;
export function createCertifiedDevicePostgresAdapter(deps:{
 db:TransactionalSql;auth:AuthVerifier;
 /** Extract session_id/exp from a token ONLY after Auth.getUser succeeds.
  * JWT signature remains verified by Supabase Auth, never by this parser. */
 readVerifiedTokenClaims:(token:string)=>{sessionId:string;expiresAtMs:number}|null;
 nowMs:()=>number;
}):AuthenticatedCanonicalIngestBackend{
 return {
  async resolveUser(token){
   const verified=await deps.auth.getUser(token);
   const claims=verified?deps.readVerifiedTokenClaims(token):null;
   if(!verified||!uuid(verified.id)||!claims||
      !uuid(claims.sessionId)||!validNow(claims.expiresAtMs)||
      claims.expiresAtMs<=deps.nowMs())return null;
   return {ownerId:verified.id,sessionId:claims.sessionId,
    expiresAtMs:claims.expiresAtMs} satisfies VerifiedAthleteSession;
  },
  async runOwnerTransaction<T>(ownerId:string,work:(tx:CanonicalIngestTransaction)=>Promise<T>){
   if(!uuid(ownerId))throw Error('Invalid verified athlete owner');
   return deps.db.begin(async sql=>{
    const operatorRole=await sql.unsafe(`
SELECT current_user AS name,rolsuper,rolbypassrls,
  pg_catalog.pg_has_role(current_user,'allin_v2_device_ingest','SET') AS can_set_ingest
FROM pg_catalog.pg_roles WHERE rolname=current_user`);
    if(operatorRole.length!==1||operatorRole[0].rolsuper!==false||
      operatorRole[0].rolbypassrls!==false||
      operatorRole[0].can_set_ingest!==true||
      !String(operatorRole[0].name).startsWith('allin_v2_ingest_operator'))
      throw Error('Dedicated least-privilege ingest operator required');
    // This local RLS claim comes ONLY from a successful Auth.getUser result;
    // it is not trusted as authentication by itself. It is transaction scoped.
    await sql.unsafe("SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
    // Serialize with lifecycle trigger and canonical scalar writer. This is a
    // *transaction-scoped* advisory lock, not a connection/session lock.
    await sql.unsafe("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('v2-metric:'||$1,0))",[ownerId]);
    let restricted=false;
    const operator=async(query:string,args:readonly unknown[]=[]):Promise<readonly Row[]>=>{
     if(restricted)throw Error('Operator query attempted while ingest role active');
     return sql.unsafe(query,args);
    };
    const authorize:CanonicalIngestTransaction['authorizeActiveOwnerSource']=async x=>{
     if(!uuid(x.ownerId)||!uuid(x.sessionId)||!uuid(x.activityId)||
      !uuid(x.sourceId)||x.ownerId!==ownerId||!safe(x.sourceRecordId)||
      !validNow(x.nowMs))return false;
     // Verify the CURRENT Auth session row, not merely an unexpired JWT.
     // SELECT-only operator cannot row-lock without UPDATE privileges; a
     // second Auth/source read before COMMIT narrows but does not eliminate
     // the revocation/commit race (requires explicit release acceptance).
     const rows=await operator(`
SELECT 1 AS allowed
FROM auth.sessions sess
JOIN auth.users athlete ON athlete.id=sess.user_id
JOIN public.v2_completed_activities act ON act.user_id=athlete.id
JOIN public.v2_activity_sources src ON src.activity_id=act.id AND src.user_id=act.user_id
JOIN allin_private.v2_device_registrations_candidate reg
  ON reg.user_id=src.user_id AND reg.device_ref=src.source_device_ref
WHERE sess.id=$1::uuid AND sess.user_id=$2::uuid
  AND (sess.not_after IS NULL OR sess.not_after>pg_catalog.now())
  AND act.id=$4::uuid AND act.status<>'invalidated'
  AND src.id=$5::uuid AND src.provider=$6 AND src.source_kind=$7
  AND src.source_record_id=$8 AND src.quality<>'rejected'
  AND reg.revoked_at IS NULL AND reg.provider=src.provider
  AND ($9::uuid IS NULL OR act.training_session_instance_id=$9::uuid)`,[
      x.sessionId,x.ownerId,x.nowMs,x.activityId,x.sourceId,
      x.provider,x.sourceKind,x.sourceRecordId,
      x.certifiedSessionInstanceId,
     ]);
     return rows.length===1;
    };
    const consume:CanonicalIngestTransaction['consumeNonce']=async x=>{
     if(x.ownerId!==ownerId||!uuid(x.sessionId)||!uuid(x.activityId)||
       !uuid(x.sourceId)||!safe(x.nonce))return false;
     const nonceHash=await sha256(x.nonce);
     const callbackHash=await sha256([x.ownerId,x.sessionId,x.activityId,
      x.sourceId,x.issuedAtMs,x.nonce].join(':'));
     // Must preserve nonce rejection at exact canonical candidate ledger.
     const rows=await operator(`
INSERT INTO allin_private.v2_device_ingest_nonce_candidate
 (nonce_hash,owner_id,activity_id,source_id,callback_hash)
 VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)
 ON CONFLICT(nonce_hash) DO NOTHING RETURNING nonce_hash`,
     [nonceHash,x.ownerId,x.activityId,x.sourceId,callbackHash]);
     return rows.length===1;
    };
    const writer:CanonicalIngestTransaction['writer']={
     appendMissingMetricsOnExactSourceReplay:true,
     findCandidates:async identity=>{
      if(identity.ownerId!==ownerId||!safe(identity.sourceRecordId))
       throw Error('Invalid canonical candidate request');
      // Only exact registered identity and certified session. No time/HR
      // heuristics, no cross-owner rows. All rows already under owner lock.
      const rows=await operator(`
SELECT s.id,s.activity_id,s.provider,s.source_kind,s.source_record_id,
 s.source_revision,s.source_payload_hash,a.training_session_instance_id
FROM public.v2_activity_sources s
JOIN public.v2_completed_activities a ON a.id=s.activity_id AND a.user_id=s.user_id
WHERE s.user_id=$1::uuid AND
 ((s.provider=$2 AND s.source_kind=$3 AND s.source_record_id=$4)
  OR ($5::uuid IS NOT NULL AND a.training_session_instance_id=$5::uuid))
ORDER BY s.id LIMIT 2001`,
       [ownerId,identity.provider,identity.sourceKind,identity.sourceRecordId,
        identity.certifiedSessionInstanceId]);
      if(rows.length>2000)throw Error('Source candidate coverage exceeded');
      const candidates=rows.map(r=>({
       canonicalActivityId:String(r.activity_id),
       identity:{ownerId,provider:String(r.provider),sourceKind:String(r.source_kind),
        sourceRecordId:String(r.source_record_id),
        revision:String(r.source_revision??'1'),
        payloadFingerprint:String(r.source_payload_hash??''),
        certifiedSessionInstanceId:r.training_session_instance_id===null?
         null:String(r.training_session_instance_id)},
      }));
      return {ownerId,sourceIdentityKey:sourceIdentityKey(identity),
       scope:'source_identity_and_relevant_overlap' as const,
       complete:true,nextCursor:null,readVersion:1,candidates};
     },
     appendVerifiedMeasurements:async args=>{
      if(args.identity.ownerId!==ownerId||!uuid(args.activityId)||
        !Number.isSafeInteger(args.expectedReadVersion)||
        args.expectedReadVersion!==1||args.metrics.length===0||
        args.metrics.length>500)throw Error('Invalid canonical append request');
      let written=false;
      for(const metric of args.metrics){
       if(metric.ownerId!==ownerId||metric.activityId!==args.activityId||
        !uuid(metric.sourceId))throw Error('Foreign metric identity');
       // Canonical scalar function owns source, sport, published registry,
       // immutable replay and typed metric authorization. Use the restricted
       // private role only while it executes; never grant UPDATE to clients.
       await sql.unsafe('SET LOCAL ROLE allin_v2_device_ingest');
       restricted=true;
       try{
        await sql.unsafe("SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
        const valueId=await deterministicUuid([ownerId,args.activityId,metric.sourceId,
         metric.metricCode,metric.definitionVersion].join(':'));
        const rows=await sql.unsafe(`
SELECT allin_private.v2_activity_append_scalar_candidate(
 $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::integer,$7,
 $8::numeric,$9,$10::boolean,$11,$12) AS result`,[
          ownerId,args.activityId,metric.sourceId,valueId,metric.metricCode,
          metric.definitionVersion,metric.measurementKind,
          metric.valueNumeric,metric.valueText,metric.valueBoolean,
          metric.sourcePayloadHash,metric.measurementQuality,
         ]);
        if(!rows.length)throw Error('Canonical scalar writer failed closed');
        const result=rows[0].result as {replayed?:boolean}|null;
        if(!result||typeof result.replayed!=='boolean')
         throw Error('Canonical scalar acknowledgement missing');
        if(!result.replayed)written=true;
       }finally{
        // Transaction-local role reset; no leaked operator privileges or
        // user GUC outside this one transaction.
        await sql.unsafe('RESET ROLE');restricted=false;
       }
      }
      return {activityId:args.activityId,
       outcome:(written?'appended':'already_applied') as 'appended'|'already_applied'};
     },
    };
    return work({authorizeActiveOwnerSource:authorize,consumeNonce:consume,writer});
   });
  },
 };
}
async function sha256(s:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(s)));
 return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function deterministicUuid(s:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(s)));
 // Deterministic RFC 4122 version-5-like UUID using SHA-256 (not a credential).
 bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
 const h=[...bytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
