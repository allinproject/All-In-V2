/** ALL-243 actual PostgreSQL enrollment adapter, no real Apple trust.
 * Only disposable local DB, synthetic Auth and malformed attestation.
 * A positive Apple enrollment requires genuine Apple CA and signed receipt.
 */
import postgres from 'npm:postgres@3.4.7';
import assert from 'node:assert/strict';
import {createAppleAppAttestEnrollmentPostgres}
 from '../supabase/functions/_shared/appleAppAttestEnrollmentPostgres.ts';
import {beginAppAttestEnrollment,completeAppAttestEnrollment}
 from '../supabase/functions/_shared/appleAppAttestEnrollmentServer.ts';
import type {TransactionalSql} from
 '../supabase/functions/_shared/certifiedDevicePostgresAdapter.ts';

const operatorUrl=Deno.env.get('ALLIN_APPATTEST_TEST_URL')??'';
const adminUrl=Deno.env.get('ALLIN_PG_ADMIN_URL')??'';
if(!operatorUrl.includes('@127.0.0.1:5432/')||
   !adminUrl.includes('@127.0.0.1:5432/'))
 throw Error('Disposable local Postgres required');
const sql=postgres(operatorUrl,{max:1,prepare:false,connect_timeout:5});
const admin=postgres(adminUrl,{max:1,prepare:false,connect_timeout:5});
const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token='verified-owner-enrollment-token';
const appId='ABCDE12345.com.allin365.app';
const now=Date.now();
const backend=createAppleAppAttestEnrollmentPostgres({
 db:sql as unknown as TransactionalSql,
 auth:{getUser:async t=>t===token?{id:owner}:null},
 readVerifiedTokenClaims:t=>t===token?{
  sessionId:session,expiresAtMs:now+600000}:null,
 nowMs:()=>Date.now(),
});
Deno.test('real owner-bound challenge persists; absent or forged Apple receipt cannot enroll',async()=>{
 try{
  const challenge=await beginAppAttestEnrollment(
   token,backend,appId,'sandbox',Date.now());
  assert.equal(challenge.challengeId.length,36);
  const stored=await admin.unsafe(`
SELECT owner_id,session_id,consumed_at,environment
FROM allin_private.v2_appattest_enrollment_challenges_candidate
WHERE id=$1::uuid`,[challenge.challengeId]);
  assert.equal(stored.length,1);
  assert.equal(stored[0].owner_id,owner);
  assert.equal(stored[0].session_id,session);
  assert.equal(stored[0].consumed_at,null);
  assert.equal(stored[0].environment,'sandbox');
  const req={challengeId:challenge.challengeId,
   keyId:'fake-key-id-untrusted',
   attestationObjectB64url:'ZmFrZS1hdHRlc3RhdGlvbg'};
  await assert.rejects(completeAppAttestEnrollment(
   token,req,backend,undefined,Date.now()),/receipt verifier unavailable/);
  await assert.rejects(completeAppAttestEnrollment(
   token,req,backend,{
    verifyAppleSignedReceipt:async()=>({
     trusted:true as const,receiptSha256:'f'.repeat(64)}),
   },Date.now()),/App Attest|attestation|CBOR|certificate|chain|Malformed|Invalid/i);
  const unused=await admin.unsafe(`
SELECT consumed_at FROM allin_private.v2_appattest_enrollment_challenges_candidate
WHERE id=$1::uuid`,[challenge.challengeId]);
  assert.equal(unused[0].consumed_at,null);
  assert.equal((await admin.unsafe(`
SELECT count(*)::int AS n FROM allin_private.v2_apple_attested_companion_keys_candidate
WHERE owner_id=$1::uuid AND key_id='fake-key-id-untrusted'`,[owner]))[0].n,0);

  await admin.unsafe(`
UPDATE auth.sessions SET not_after=now()-interval '1 second'
WHERE id=$1::uuid`,[session]);
  await assert.rejects(beginAppAttestEnrollment(
   token,backend,appId,'sandbox',Date.now()),/challenge issue denied|session/i);
  await admin.unsafe(`
UPDATE auth.sessions SET not_after=now()+interval '1 day'
WHERE id=$1::uuid`,[session]);
 }finally{
  await sql.end({timeout:3});await admin.end({timeout:3});
 }
});
