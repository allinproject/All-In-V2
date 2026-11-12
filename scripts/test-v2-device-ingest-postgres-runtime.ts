/** ALL-243: true TypeScript adapter -> disposable PostgreSQL 17 test.
 * Deno runtime with pinned postgres.js. NEVER connect to hosted Supabase.
 * Database is provisioned by the isolated GitHub Actions service.
 */
import postgres from 'npm:postgres@3.4.7';
import assert from 'node:assert/strict';
import {createCertifiedDevicePostgresAdapter} from
 '../supabase/functions/_shared/certifiedDevicePostgresAdapter.ts';
import {signInternalDeviceEnvelope,ingestVerifiedDeviceEnvelopeTransactional}
 from '../supabase/functions/_shared/certifiedDeviceIngestServer.ts';

const dbUrl=Deno.env.get('ALLIN_PG_TEST_URL');
const adminUrl=Deno.env.get('ALLIN_PG_ADMIN_URL');
if(!dbUrl||!adminUrl||!dbUrl.includes('127.0.0.1:5432')||
   !adminUrl.includes('127.0.0.1:5432'))
 throw new Error('Disposable local PostgreSQL URLs required');
const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activity='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bearer='fixture-verified-auth-user';
const secret='isolated-internal-HMAC-authorization-secret-only';
const hash='a'.repeat(64);
const now=Date.now();
const payload={verifiedByProviderAdapter:true as const,
 identity:{ownerId:owner,provider:'supported_equipment',
  sourceKind:'device_session',sourceRecordId:'trainer-42',revision:'1',
  payloadFingerprint:hash,certifiedSessionInstanceId:null},
 source:{ownerId:owner,activityId:activity,sourceId:source,
  sourceQuality:'trusted' as const,provider:'supported_equipment' as const,
  certifiedByServer:true as const},
 observations:[{metricCode:'ingest_runtime_metric',definitionVersion:1,
  measurementKind:'source_measured' as const,valueNumeric:123,
  valueText:null,valueBoolean:null,sampleQuality:'partial' as const,
  sourcePayloadHash:hash}],
};
const operator=postgres(dbUrl,{max:1,prepare:false,connect_timeout:5});
const admin=postgres(adminUrl,{max:1,prepare:false,connect_timeout:5});
const backend=createCertifiedDevicePostgresAdapter({
 db:operator,
 auth:{getUser:async token=>token===bearer?{id:owner}:null},
 readVerifiedTokenClaims:token=>token===bearer?{
  sessionId:session,expiresAtMs:now+600000}:null,
 nowMs:()=>Date.now(),
});
async function send(id:string,p=payload,stamp=Date.now()){
 const envelope=await signInternalDeviceEnvelope(p,stamp,
   ('runtime-nonce-'+id).padEnd(30,'x'),secret);
 return ingestVerifiedDeviceEnvelopeTransactional(envelope,backend,
  bearer,secret,stamp);
}
Deno.test('authenticated device ingestion uses real owner PostgreSQL transaction',async()=>{
 try{
  const result=await send('first');
  assert.deepEqual(result,{status:'written',activityId:activity});
  const persisted=await admin.unsafe(
   "SELECT metric_code,value_numeric,quality FROM public.v2_activity_metric_values WHERE user_id=$1 AND metric_code='ingest_runtime_metric'",[owner]);
  assert.equal(persisted.length,1);
  assert.equal(Number(persisted[0].value_numeric),123);
  assert.equal(persisted[0].quality,'partial');

  // Reusing signed nonce is rejected; fresh trusted offline retry is
  // idempotent against the canonical scalar writer, no extra measurement.
  await assert.rejects(send('first'),/nonce|replay/);
  assert.deepEqual(await send('retry'),{status:'already_applied',activityId:activity});
  assert.equal((await admin.unsafe(
   "SELECT count(*)::int AS n FROM public.v2_activity_metric_values WHERE user_id=$1 AND metric_code='ingest_runtime_metric'",[owner]))[0].n,1);

  // A changed numeric fact with same source/version is a canonical conflict.
  // The nonce for that failed transaction must not persist.
  await assert.rejects(send('tampered',{...payload,observations:[
    {...payload.observations[0],valueNumeric:124}]}),/conflict/i);
  assert.equal((await admin.unsafe(
   "SELECT count(*)::int AS n FROM allin_private.v2_device_ingest_nonce_candidate WHERE owner_id=$1",[owner]))[0].n,4);
  // This initial ledger also includes the two nonce receipts from the
  // earlier two-owner and operator fixtures. Exactly two NEW receipts above.

  // Fresh JWT identity is NOT enough: an expired auth.sessions row blocks
  // the transaction even when the user resolver still returns the athlete.
  await admin.unsafe("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1",[session]);
  await assert.rejects(send('expired'),/session|source denied/);
  await admin.unsafe("UPDATE auth.sessions SET not_after=now()+interval '1 day' WHERE id=$1",[session]);

  // Revoked device binding blocks a legitimate Auth session.
  await admin.unsafe("UPDATE allin_private.v2_device_registrations_candidate SET revoked_at=now() WHERE user_id=$1 AND device_ref='paired-trainer-42'",[owner]);
  await assert.rejects(send('revoked'),/source denied/);

  const actual=await admin.unsafe(
   "SELECT count(*)::int AS n FROM public.v2_activity_metric_values WHERE user_id=$1 AND metric_code='ingest_runtime_metric'",[owner]);
  assert.equal(actual[0].n,1);
 }finally{
  await operator.end({timeout:3});
  await admin.end({timeout:3});
 }
});
