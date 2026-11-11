'use strict';
/**
 * ALL-251: TRUE independent PostgreSQL session claim-vs-cancel regression.
 * NEVER USE ON A LIVE/SHARED SUPABASE DATABASE. Requires disposable local test DB.
 * This script INSERTS/DELETES TWO SYNTHETIC AUTH USERS and temporarily enables
 * the private processor gate in the isolated database. It NEVER deletes through
 * Auth Admin; all synthetic data is cleaned up in finally.
 *
 * Install pg in your isolated test workspace first; then:
 * ALL251_ISOLATED_TEST_DB=YES_DISPOSABLE ALL251_TEST_DATABASE_URL=postgres://..._test node this-file.cjs
 * The target database name MUST end _test or _isolated and host MUST be loopback.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const marker = process.env.ALL251_ISOLATED_TEST_DB;
const target = process.env.ALL251_TEST_DATABASE_URL;
if (marker !== 'YES_DISPOSABLE' || !target) {
  throw Error('Refusing race fixture: require explicit isolated database opt-in');
}
const parsed = new URL(target);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) ||
    !/(?:_test|_isolated)$/.test(decodeURIComponent(parsed.pathname).replace(/^\//, ''))) {
  throw Error('Refusing race fixture: must target loopback database named *_test or *_isolated');
}
const lockFor = userId => 'v2-delete-request:' + userId;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Verify a *real separate backend* is waiting for an advisory lock. A delay
// alone cannot prove concurrency if a driver serialized requests.
async function waitForLockWait(observer, waitingPid, description) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await observer.query(
      "select wait_event_type,wait_event from pg_stat_activity where pid=$1", [waitingPid]);
    if (result.rows[0]?.wait_event_type === 'Lock' &&
        result.rows[0]?.wait_event === 'advisory') return;
    await sleep(100);
  }
  throw Error('No independently blocked advisory-lock session observed: ' + description);
}
async function connect() {
  const client = new Client({ connectionString: target, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}
async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); } catch { /* Retain original error. */ }
}
async function run() {
  const admin = await connect();
  const winner = await connect();
  const loser = await connect();
  const users = [randomUUID(), randomUUID()];
  const requests = [randomUUID(), randomUUID()];
  let originalGate = null;
  try {
    assert.notEqual(winner.processID, loser.processID, 'Must use independent Postgres backends');
    assert.notEqual(admin.processID, winner.processID, 'Observer must use separate Postgres backend');
    // Never change a populated database's processing gate, even if the URL
    // appears disposable. Keep this test strictly confined to empty fixtures.
    const preflight = await admin.query(`
      select current_database() as db,
        (select count(*)::int from auth.users) as auth_users,
        (select count(*)::int from allin_private.v2_account_deletion_requests) as requests,
        (select count(*)::int from allin_private.v2_account_deletion_execution_audit) as audits,
        (select count(*)::int from storage.buckets) as buckets`);
    const env = preflight.rows[0];
    assert.match(env.db, /(?:_test|_isolated)$/, 'Database name must be disposable');
    for (const key of ['auth_users','requests','audits','buckets'])
      assert.equal(env[key], 0, 'Refusing to touch nonempty test database: ' + key);
    await admin.query("set statement_timeout='8000ms'");
    await winner.query("set statement_timeout='8000ms'");
    await loser.query("set statement_timeout='8000ms'");
    const gate = await admin.query('select execution_enabled from allin_private.v2_account_deletion_processor_config where singleton=true');
    assert.equal(gate.rowCount, 1);
    originalGate = gate.rows[0].execution_enabled;
    assert.equal(originalGate, false, 'Test database should start with processing disabled');
    await admin.query("update allin_private.v2_account_deletion_processor_config set execution_enabled=true,change_reason='ALL-251 disposable two-session test' where singleton=true");
    for (let i = 0; i < 2; i++) {
      await admin.query(
        "insert into auth.users(id,instance_id,aud,role,email) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)",
        [users[i], 'all251-two-session-' + users[i] + '@invalid.example']
      );
      await admin.query(
        'insert into allin_private.v2_account_deletion_requests(user_id,request_id) values ($1,$2)',
        [users[i], requests[i]]
      );
    }

    // CASE ONE: claim acquires the account lock, cancellation waits, then fails.
    await winner.query('BEGIN');
    await winner.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [lockFor(users[0])]);
    const claimed = await winner.query('select public.v2_claim_account_deletion_for_processing($1,$2) as receipt',
      [users[0], requests[0]]);
    assert.equal(claimed.rows[0].receipt.status, 'processing');
    await loser.query('BEGIN');
    await loser.query('SET LOCAL ROLE authenticated');
    await loser.query("select set_config('request.jwt.claim.sub',$1,true)", [users[0]]);
    let settled = false;
    const cancellation = loser.query('select public.v2_cancel_account_deletion_request($1,$2)', [users[0],requests[0]])
      .then(value => { settled = true; return {value}; }, error => {settled = true; return {error};});
    await waitForLockWait(admin, loser.processID, 'cancel following claim');
    assert.equal(settled, false, 'Cancellation must remain blocked behind claim lock');
    await winner.query('COMMIT');
    const cancelled = await cancellation;
    assert.equal(cancelled.error?.code, '42501', 'Cancellation must reject a claimed request');
    await loser.query('ROLLBACK');

    // CASE TWO: cancellation acquires lock, claim waits, then fails.
    await winner.query('BEGIN');
    await winner.query('SET LOCAL ROLE authenticated');
    await winner.query("select set_config('request.jwt.claim.sub',$1,true)", [users[1]]);
    await winner.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [lockFor(users[1])]);
    const cancelledFirst = await winner.query('select public.v2_cancel_account_deletion_request($1,$2) as receipt',
      [users[1],requests[1]]);
    assert.equal(cancelledFirst.rows[0].receipt.status, 'cancelled');
    await loser.query('BEGIN');
    settled = false;
    const claim = loser.query('select public.v2_claim_account_deletion_for_processing($1,$2)', [users[1],requests[1]])
      .then(value => {settled = true;return {value};}, error => {settled = true;return {error};});
    await waitForLockWait(admin, loser.processID, 'claim following cancel');
    assert.equal(settled, false, 'Claim must remain blocked behind cancellation lock');
    await winner.query('COMMIT');
    const processed = await claim;
    assert.equal(processed.error?.code, '42501', 'Claim must reject cancelled request');
    await loser.query('ROLLBACK');
    process.stdout.write('PASS ALL-251 two independent sessions: claim-first and cancel-first ordering\n');
  } finally {
    await rollbackQuietly(winner);
    await rollbackQuietly(loser);
    // Clean up ONLY synthetic fixture users. Auth FK cascades profile/request records.
    // A rollback of a claimed transaction cannot leave durable processing.
    // A committed claim leaves audit evidence that is cleared by exact owner.
    try {
      for (const id of users) {
        await admin.query('delete from auth.users where id=$1', [id]);
        await admin.query('delete from allin_private.v2_account_deletion_execution_audit where user_id=$1', [id]);
      }
    } finally {
      try {
        // Restore the OFF gate EVEN IF synthetic fixture cleanup failed.
        if (originalGate !== null) {
          await admin.query("update allin_private.v2_account_deletion_processor_config set execution_enabled=$1,change_reason='ALL-251 disposable test restored' where singleton=true", [originalGate]);
        }
      } finally {
        await Promise.allSettled([winner.end(), loser.end(), admin.end()]);
      }
    }
  }
}
run().catch(error => {
  process.stderr.write('ALL-251 RACE TEST FAILED: '+String(error?.message ?? error)+'\n');
  process.exitCode = 1;
});
