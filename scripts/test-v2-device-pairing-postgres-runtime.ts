/** ALL-243 real Deno -> disposable PostgreSQL registrar transaction proof.
 * Uses fixture-only Auth resolver; independently rechecks actual auth.sessions.
 * Never points at hosted Supabase or a production DB.
 */
import postgres from 'npm:postgres@3.4.7';
import assert from 'node:assert/strict';
import {createDevicePairingPostgresBackend} from
 '../supabase/functions/_shared/certifiedDevicePairingPostgres.ts';
import type {TransactionalSql} from
 '../supabase/functions/_shared/certifiedDevicePostgresAdapter.ts';
import {issueDevicePairingChallenge,completeVerifiedDevicePairing,
 signTrustedDeviceProof,revokeOwnedDevice} from
 '../supabase/functions/_shared/certifiedDevicePairingServer.ts';

const url=Deno.env.get('ALLIN_PAIRING_TEST_URL');
const adminUrl=Deno.env.get('ALLIN_PG_ADMIN_URL');
if(!url||!adminUrl||!url.includes('@127.0.0.1:5432/')||
 !adminUrl.includes('@127.0.0.1:5432/'))
 throw Error('Disposable PostgreSQL test URL required');
const registrar=postgres(url,{max:1,prepare:false,connect_timeout:5});
const admin=postgres(adminUrl,{max:1,prepare:false,connect_timeout:5});
const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bearer='verified-account-session-from-trusted-test-auth';
const secret='approved-server-verifier-private-signing-fixture';
const now=Date.now();
const backend=createDevicePairingPostgresBackend({
 db:registrar as unknown as TransactionalSql,
 auth:{getUser:async token=>token===bearer?{id:owner}:null},
 readVerifiedTokenClaims:token=>token===bearer?{
  sessionId:session,expiresAtMs:now+600000}:null,
 nowMs:()=>Date.now(),
});
Deno.test('server-only challenge, verified device registration, replay denial and revoke in real PG17',async()=>{
 try{
  const challenge=await issueDevicePairingChallenge(bearer,{
   provider:'apple_watch',deviceRef:'runtime-watch-777'},backend,Date.now());
  const evidence=await signTrustedDeviceProof({
   challengeId:challenge.challengeId,ownerId:owner,sessionId:session,
   provider:'apple_watch',deviceRef:'runtime-watch-777',
   attestationKind:'native_owner_verified',evidenceHash:'c'.repeat(64),
   issuedAtMs:Date.now(),
  },secret);
  const paired=await completeVerifiedDevicePairing(bearer,evidence,
   backend,secret,Date.now());
  assert.equal(paired.status,'paired');
  const rows=await admin.unsafe(`
SELECT user_id,provider,revoked_at FROM allin_private.v2_device_registrations_candidate
WHERE id=$1::uuid`,[paired.deviceId]);
  assert.equal(rows.length,1);assert.equal(rows[0].user_id,owner);
  assert.equal(rows[0].provider,'apple_watch');
  assert.equal(rows[0].revoked_at,null);
  // Same signed proof or stolen challenge cannot create another registration.
  await assert.rejects(completeVerifiedDevicePairing(bearer,evidence,
   backend,secret,Date.now()),/challenge|consumed|pairing/i);
  // Auth getUser succeeds; database expiry still denies pairing/revocation.
  await admin.unsafe(`
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1::uuid`,[session]);
  await assert.rejects(revokeOwnedDevice(bearer,paired.deviceId,backend,Date.now()),
   /authorization|session/i);
  await admin.unsafe(`
UPDATE auth.sessions SET not_after=now()+interval '1 day' WHERE id=$1::uuid`,[session]);
  assert.deepEqual(await revokeOwnedDevice(bearer,paired.deviceId,backend,Date.now()),
   {status:'revoked'});
  assert.deepEqual(await revokeOwnedDevice(bearer,paired.deviceId,backend,Date.now()),
   {status:'already_revoked'});
  const persisted=await admin.unsafe(`
SELECT revoked_at FROM allin_private.v2_device_registrations_candidate
WHERE id=$1::uuid`,[paired.deviceId]);
  assert.notEqual(persisted[0].revoked_at,null);
  const events=await admin.unsafe(`
SELECT event_type FROM allin_private.v2_device_pairing_audit_candidate
WHERE device_id=$1::uuid ORDER BY occurred_at`,[paired.deviceId]);
  assert.deepEqual(events.map(x=>x.event_type),['paired','revoked']);
 }finally{
  await registrar.end({timeout:3});await admin.end({timeout:3});
 }
});
