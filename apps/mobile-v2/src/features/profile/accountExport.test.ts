import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareV2AccountExport, V2_ACCOUNT_EXPORT_VERSION, V2_EXPORT_MAX_CHARS } from './accountExport.ts';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251';
const valid = () => ({
  schema_version: V2_ACCOUNT_EXPORT_VERSION,
  exported_at: '2026-11-11T00:00:00Z',
  account: { id: owner, email: 'test@invalid.example' },
  profile: null, profile_settings: null, onboarding_progress: null,
  legal_acceptances: [], health_considerations: null,
  profile_settings_actions: [], onboarding_actions: [],
  deletion_request: null, deletion_execution: null,
});
test('serializes only a matching complete owner snapshot', () => {
  const result = prepareV2AccountExport(valid(), owner);
  assert.equal(JSON.parse(result).account.id, owner);
});
test('rejects session owner mismatch', () => {
  assert.throws(() => prepareV2AccountExport(valid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251'), /signed-in owner/);
});
test('refuses missing private data sections', () => {
  const value = valid() as Record<string, unknown>;
  delete value.health_considerations;
  assert.throws(() => prepareV2AccountExport(value, owner), /incomplete/);
});
test('rejects version drift and invalid response shape', () => {
  assert.throws(() => prepareV2AccountExport({...valid(), schema_version:'other'},owner), /not supported/);
  assert.throws(() => prepareV2AccountExport([],owner), /invalid snapshot/);
});
test('refuses oversized temporary file export', () => {
  assert.throws(() => prepareV2AccountExport({...valid(), account:{id:owner, email:'x'.repeat(V2_EXPORT_MAX_CHARS)}},owner), /too large/);
});

test('rejects a foreign-owned nested profile, even with a matching account ID', () => {
  const value = { ...valid(), profile: { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251' } };
  assert.throws(() => prepareV2AccountExport(value, owner), /other-account/);
});
test('rejects foreign-owned action rows', () => {
  const value = { ...valid(), onboarding_actions: [{user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb251'}] };
  assert.throws(() => prepareV2AccountExport(value, owner), /other-account/);
});
test('requires arrays for collection sections', () => {
  const value = { ...valid(), legal_acceptances: null };
  assert.throws(() => prepareV2AccountExport(value, owner), /invalid/);
});
