// ALL-222: offline guard for the V2 foundation that was compared byte-for-byte
// with the applied Supabase migration ledger on 2026-11-11.
// Add subsequent migrations normally; never edit or re-version applied history.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationDir = resolve(root, 'supabase/migrations');
const baseline = Object.freeze({
  '20261110021548_v2_auth_profile_legal_foundation.sql': '717ee71a9cab7402424122999bfde913bde0c61a',
  '20261110022457_v2_tighten_profile_privileges_and_legal_versions.sql': 'f90db2e6ebc8fc9aff5e9b692ddd3151341d83ae',
  '20261110032039_v2_provider_cache_and_private_rls.sql': '6e476a6009d6dd4496dd50c0a020df5cddb65677',
  '20261110101200_v2_onboarding_progress_writer.sql': 'b3d6ae6dc79c146fad76cd40a8a537314dc66d55',
  '20261110105423_v2_expected_owner_mutation_guards.sql': '1892b128b78adf63bd5f71c48a5b0da96646416b',
  '20261110122952_v2_provider_cache_expired_cleanup.sql': '9bbdd1fff03545053187ebaea70d7ace6a0a58a1',
  '20261110124420_v2_provider_cache_cron_schedule.sql': 'ac31d98a19955914aa26e4ff5be2329af98c47e6',
  '20261111110324_v2_private_health_considerations_opt_in.sql': 'a5d5695ef22417eae4d89d0f163d5c17caf1fc82',
  '20261111120805_v2_owner_verified_account_deletion_request_intake.sql': '302dfbfa40e7078de68730628b35fc954a25e780',
  '20261111121605_v2_owner_bound_deletion_request_cancel_before_processing.sql': 'f171bda2d49897a89e41d30d2ece78f524c49566',
  '20261111123133_v2_service_only_deletion_processing_claim.sql': '4f4a3ac40a75137e0c3704747d44a5194884c432',
  '20261111123642_v2_account_deletion_processor_default_off_gate.sql': 'b8b88d9006715d0367480ea49db00812cb8a741e',
  '20261111123939_v2_deletion_claim_fail_closed_storage_and_owner_coverage.sql': '32d9847148e180fdb70ed5494734154d734927a3',
  '20261111124645_v2_deletion_durable_minimal_execution_audit_and_receipts.sql': 'e842e622d92e3bf9199a7019faa8dde8c3233a0a',
  '20261111130824_v2_deletion_completion_verify_auth_sessions_and_owner_rows.sql': '5ce35419a35b5a5d06450a9b25eb87748897727a',
  '20261111131212_v2_stale_auth_token_account_existence_guards.sql': '69ce82fb7f2d8802a168f863bab023e8df4380c2',
  '20261111133540_v2_deletion_completion_readback_after_ambiguous_receipt.sql': '447484bb47480fe6fa6033c1162f5fb70026ddb6',
  '20261111134456_v2_owner_bound_current_data_export_snapshot.sql': 'f7a68ee1eecf3b6666ef9a6282e11f27874ad58c',
});
const boundary = '20261111134456';
const files = readdirSync(migrationDir).filter(name => name.endsWith('.sql'));
const seenVersions = new Set();
const seenNames = new Set();
for (const filename of files) {
  const match = /^(\d{14})_([a-z][a-z0-9_]*)\.sql$/.exec(filename);
  assert.ok(match, `Invalid V2 migration filename: ${filename}`);
  const [, version, name] = match;
  assert.ok(!seenVersions.has(version), `Duplicate V2 migration version: ${version}`);
  assert.ok(!seenNames.has(name), `Repeated V2 migration name: ${name}`);
  seenVersions.add(version);
  seenNames.add(name);
  assert.ok(version > boundary || Object.hasOwn(baseline, filename),
    `Unreviewed historical migration version: ${filename}`);
}
for (const [filename, expectedBlob] of Object.entries(baseline)) {
  assert.ok(files.includes(filename), `Applied V2 migration missing: ${filename}`);
  const content = readFileSync(resolve(migrationDir, filename));
  const actual = createHash('sha1')
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest('hex');
  assert.equal(actual, expectedBlob, `Applied V2 migration changed: ${filename}`);
}
console.log(`PASS: ${Object.keys(baseline).length} immutable applied foundation migrations and ${files.length - Object.keys(baseline).length} future migrations`);
