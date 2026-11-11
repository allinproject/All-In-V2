'use strict';
/**
 * ALL-217: isolated V2 Coach owner-schema replay. NEVER use on production.
 * Requires PostgreSQL with Supabase V2 auth/profile foundation and pg driver.
 * ALL217_ISOLATED_TEST_DB=YES_DISPOSABLE
 * ALL217_TEST_DATABASE_URL=postgres://...@127.0.0.1:5432/allin_v2_coach_test
 * node supabase/tests/all217_local_owner_replay.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function targetIsDisposable(marker, rawUrl) {
  if (marker !== 'YES_DISPOSABLE' || !rawUrl) return false;
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) return false;
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) return false;
  if (u.search || u.hash) return false;
  const database = decodeURIComponent(u.pathname).replace(/^\//, '');
  return /(?:_test|_isolated)$/.test(database) && database.length > 8;
}
if (!targetIsDisposable(process.env.ALL217_ISOLATED_TEST_DB,
                        process.env.ALL217_TEST_DATABASE_URL)) {
  throw Error('Refusing Coach SQL replay: explicit disposable loopback *_test or *_isolated Postgres required');
}
// Do not even import pg until the target is proven disposable.
const {Client} = require('pg');
const root = path.resolve(__dirname, '../..');
const candidate = fs.readFileSync(path.join(root,
  'docs/architecture/sql/V2-COACH-OWNER-MIGRATION-CANDIDATE.sql'), 'utf8');
const replay = fs.readFileSync(path.join(root,
  'supabase/tests/v2_coach_owner_atomic_exchange_rollback.sql'), 'utf8');

async function main() {
  const client = new Client({
    connectionString: process.env.ALL217_TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000
  });
  let inTransaction = false;
  try {
    await client.connect();
    const preflight = await client.query([
      'select current_database() as db,',
      '(select count(*)::int from auth.users) as users,',
      '(select count(*)::int from public.v2_profiles) as profiles,',
      "(select count(*)::int from pg_catalog.pg_class where relnamespace='public'::regnamespace",
      "and relname in ('v2_coach_threads','v2_coach_messages')) as coach_tables,",
      "(select count(*)::int from pg_catalog.pg_roles",
      "where rolname in ('authenticated','anon','service_role')) as app_roles"
    ].join(' '));
    const state = preflight.rows[0];
    assert.match(state.db, /(?:_test|_isolated)$/);
    assert.equal(state.users, 0, 'Refusing populated database: Auth users');
    assert.equal(state.profiles, 0, 'Refusing populated database: V2 profiles');
    assert.equal(state.coach_tables, 0, 'Refusing database with existing Coach tables');
    assert.equal(state.app_roles, 3, 'Supabase application roles are required');
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(candidate);
    // Replay contains its own BEGIN/ROLLBACK. PostgreSQL ignores the nested
    // BEGIN and rolls back BOTH the candidate schema and synthetic data.
    await client.query(replay);
    inTransaction = false;
    const after = await client.query([
      'select count(*)::int as coach_tables from pg_catalog.pg_class',
      "where relnamespace='public'::regnamespace",
      "and relname in ('v2_coach_threads','v2_coach_messages')"
    ].join(' '));
    assert.equal(after.rows[0].coach_tables, 0,
      'Proposed schema was not rolled back');
    const remaining = await client.query('select count(*)::int as users from auth.users');
    assert.equal(remaining.rows[0].users, 0,
      'Synthetic Auth users were not rolled back');
    process.stdout.write('PASS ALL-217 isolated Coach owner SQL rollback (single backend)\n');
    process.stdout.write('NOT COVERED: true concurrent session race, Edge/JWT, device/model.\n');
  } finally {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* Retain original error. */ }
    }
    await client.end().catch(() => {});
  }
}
main().catch(error => {
  process.stderr.write('FAIL ALL-217 local SQL replay: ' + error.message + '\n');
  process.exitCode = 1;
});
