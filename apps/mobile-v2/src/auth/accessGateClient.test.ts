import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV2SessionOwner,
  parsePublishedV2LegalDocuments,
  shouldEnterV2Onboarding,
  v2LegalAcceptanceMatches,
} from './accessGateClient.ts';

const docs = [
  { document_key: 'terms', version: 'terms-v2', title: 'Terms', content_markdown: 'Terms text', content_sha256: null, effective_at: '2026-11-10T00:00:00.000Z' },
  { document_key: 'privacy', version: 'privacy-v2', title: 'Privacy', content_markdown: 'Privacy text', content_sha256: null, effective_at: '2026-11-10T00:00:00.000Z' },
  { document_key: 'founder_beta_terms', version: 'founder-v2', title: 'Founder Beta Terms', content_markdown: 'Beta text', content_sha256: null, effective_at: '2026-11-10T00:00:00.000Z' },
];

test('all three published legal documents are required before V2 access can proceed', () => {
  assert.equal(parsePublishedV2LegalDocuments(docs).length, 3);
  assert.throws(() => parsePublishedV2LegalDocuments([]), /signup remains closed/i);
  assert.throws(() => parsePublishedV2LegalDocuments(docs.slice(0, 2)), /signup remains closed/i);
});

test('duplicate or incomplete legal document records fail closed', () => {
  assert.throws(() => parsePublishedV2LegalDocuments([...docs, docs[0]]), /Duplicate/);
  assert.throws(() => parsePublishedV2LegalDocuments([{ ...docs[0], content_markdown: '' }, ...docs.slice(1)]), /incomplete/i);
});

test('legal acceptance must match the currently published exact versions and age confirmation', () => {
  const required = parsePublishedV2LegalDocuments(docs);
  const accepted = { terms_version: 'terms-v2', privacy_version: 'privacy-v2', founder_beta_terms_version: 'founder-v2', age_18_confirmed: true };
  assert.equal(v2LegalAcceptanceMatches(accepted, required), true);
  assert.equal(v2LegalAcceptanceMatches({ ...accepted, terms_version: 'old-terms' }, required), false);
  assert.equal(v2LegalAcceptanceMatches({ ...accepted, age_18_confirmed: false }, required), false);
  assert.equal(v2LegalAcceptanceMatches(null, required), false);
});

test('all six canonical onboarding steps are required', () => {
  assert.equal(shouldEnterV2Onboarding(null, { completedSteps: [], skippedSteps: [] }), true);
  assert.equal(shouldEnterV2Onboarding(null, { completedSteps: ['focus', 'training_pattern'], skippedSteps: [] }), true);
  assert.equal(shouldEnterV2Onboarding(null, {
    completedSteps: ['focus', 'training_pattern', 'availability', 'coach', 'food_safety'],
    skippedSteps: ['proactivity'],
  }), false);
});

test('session owner guard permits the expected authenticated account', async () => {
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'user-a' } } },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof assertV2SessionOwner>[0];
  await assertV2SessionOwner(client, 'user-a');
});

test('session owner guard rejects missing or switched accounts', async () => {
  const switchedClient = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'user-b' } } },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof assertV2SessionOwner>[0];
  const signedOutClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  } as unknown as Parameters<typeof assertV2SessionOwner>[0];
  await assert.rejects(assertV2SessionOwner(switchedClient, 'user-a'), /account changed/i);
  await assert.rejects(assertV2SessionOwner(signedOutClient, 'user-a'), /account changed/i);
});

test('session owner guard propagates session lookup errors', async () => {
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: null },
        error: new Error('session lookup failed'),
      }),
    },
  } as unknown as Parameters<typeof assertV2SessionOwner>[0];
  await assert.rejects(assertV2SessionOwner(client, 'user-a'), /session lookup failed/);
});
