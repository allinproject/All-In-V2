import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertV2SessionOwner,
  assertV2SignupLegalSnapshotCurrent,
  parsePublishedV2LegalDocuments,
  resolveV2Access,
  readV2OwnedProfileState,
  shouldEnterV2Onboarding,
  v2LegalAcceptanceMatches,
  v2LegalReviewKey,
  v2LegalReviewSetKey,
  v2SignupAcceptanceRetryScope,
  v2SignupConsentScope,
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

test('published legal documents fail closed when content would otherwise be truncated', () => {
  assert.throws(
    () => parsePublishedV2LegalDocuments([{ ...docs[0], content_markdown: 'a'.repeat(50001) }, ...docs.slice(1)]),
    /incomplete/i,
  );
  assert.equal(
    parsePublishedV2LegalDocuments([{ ...docs[0], content_markdown: 'a'.repeat(50000) }, ...docs.slice(1)])[0].content_markdown.length,
    50000,
  );
  assert.throws(
    () => parsePublishedV2LegalDocuments([{ ...docs[0], version: 'v'.repeat(121) }, ...docs.slice(1)]),
    /incomplete/i,
  );
});

test('legal acceptance must match the currently published exact versions and age confirmation', () => {
  const required = parsePublishedV2LegalDocuments(docs);
  const accepted = { terms_version: 'terms-v2', privacy_version: 'privacy-v2', founder_beta_terms_version: 'founder-v2', age_18_confirmed: true };
  assert.equal(v2LegalAcceptanceMatches(accepted, required), true);
  assert.equal(v2LegalAcceptanceMatches({ ...accepted, terms_version: 'old-terms' }, required), false);
  assert.equal(v2LegalAcceptanceMatches({ ...accepted, age_18_confirmed: false }, required), false);
  assert.equal(v2LegalAcceptanceMatches(null, required), false);
});

test('legal review checkmarks are scoped to document versions, content and current account', () => {
  const terms = docs[0];
  const current = v2LegalReviewKey('user-a', terms);
  assert.equal(current, v2LegalReviewKey('user-a', { ...terms }));
  assert.notEqual(current, v2LegalReviewKey('user-a', { ...terms, version: 'terms-v3' }));
  assert.notEqual(current, v2LegalReviewKey('user-a', { ...terms, content_sha256: 'new-content-sha' }));
  assert.notEqual(current, v2LegalReviewKey('user-a', { ...terms, content_markdown: 'Changed text without digest' }));
  assert.notEqual(current, v2LegalReviewKey('user-a', { ...terms, title: 'Changed document title' }));
  assert.notEqual(current, v2LegalReviewKey('user-a', { ...terms, effective_at: '2026-11-11T00:00:00.000Z' }));
  assert.notEqual(current, v2LegalReviewKey('user-b', terms));

  const reviewed = { [current]: true };
  assert.equal(Boolean(reviewed[v2LegalReviewKey('user-a', { ...terms, version: 'terms-v3' })]), false);
  assert.equal(Boolean(reviewed[v2LegalReviewKey('user-b', terms)]), false);
});

test('legal age confirmation applies only to the current account and legal revision set', () => {
  const confirmedSet = v2LegalReviewSetKey('user-a', docs);
  assert.equal(confirmedSet, v2LegalReviewSetKey('user-a', docs.map(doc => ({ ...doc }))));
  assert.notEqual(confirmedSet, v2LegalReviewSetKey('user-b', docs));
  assert.notEqual(confirmedSet, v2LegalReviewSetKey('user-a', [
    { ...docs[0], version: 'terms-v3' },
    ...docs.slice(1),
  ]));
  assert.notEqual(confirmedSet, v2LegalReviewSetKey('user-a', [
    { ...docs[0], content_sha256: 'changed-content' },
    ...docs.slice(1),
  ]));
  assert.notEqual(confirmedSet, v2LegalReviewSetKey('user-a', [
    { ...docs[0], content_markdown: 'New Terms without updated digest' },
    ...docs.slice(1),
  ]));
});

test('signup consent scope requires the same email and published legal revisions', () => {
  const original = v2SignupConsentScope(' Athlete@Example.COM ', docs);
  assert.equal(original, v2SignupConsentScope('athlete@example.com', docs.map(doc => ({ ...doc }))));
  assert.notEqual(original, v2SignupConsentScope('other@example.com', docs));
  assert.notEqual(original, v2SignupConsentScope('athlete@example.com', [
    { ...docs[0], version: 'terms-v3' },
    ...docs.slice(1),
  ]));
  assert.notEqual(original, v2SignupConsentScope('athlete@example.com', [
    { ...docs[0], content_sha256: 'new-content' },
    ...docs.slice(1),
  ]));
  assert.notEqual(original, v2SignupConsentScope('athlete@example.com', [
    { ...docs[0], content_markdown: 'Revised without hash' },
    ...docs.slice(1),
  ]));
});

test('signup legal receipt retries cannot reuse an action ID for another created account', () => {
  const reviewed = v2SignupConsentScope('athlete@example.com', docs);
  const a = v2SignupAcceptanceRetryScope(reviewed, 'user-a');
  assert.equal(a, v2SignupAcceptanceRetryScope(reviewed, 'user-a'));
  assert.notEqual(a, v2SignupAcceptanceRetryScope(reviewed, 'user-b'));
  assert.notEqual(a, v2SignupAcceptanceRetryScope(v2SignupConsentScope('other@example.com', docs), 'user-a'));
});

test('signup legal parsing rejects incomplete published documents and duplicates', () => {
  assert.throws(() => parsePublishedV2LegalDocuments([{ ...docs[0], content_markdown: '' }, ...docs.slice(1)]), /incomplete/i);
  assert.throws(() => parsePublishedV2LegalDocuments([...docs, { ...docs[0], version: 'old-version' }]), /Duplicate/);
});

test('signup preflight detects a newly published legal version before account creation', () => {
  const original = parsePublishedV2LegalDocuments(docs);
  const same = original.map(doc => ({ ...doc }));
  assert.deepEqual(assertV2SignupLegalSnapshotCurrent(original, same), original);
  assert.throws(
    () => assertV2SignupLegalSnapshotCurrent(original, [
      { ...docs[0], version: 'terms-v3' }, ...docs.slice(1),
    ]),
    /legal documents changed/i,
  );
});

test('signup preflight refuses revised legal wording even when content digest and version were not updated', () => {
  const original = parsePublishedV2LegalDocuments(docs);
  assert.throws(
    () => assertV2SignupLegalSnapshotCurrent(original, [
      { ...docs[0], content_markdown: 'New terms text' }, ...docs.slice(1),
    ]),
    /legal documents changed/i,
  );
  assert.throws(
    () => assertV2SignupLegalSnapshotCurrent(original, [
      { ...docs[0], title: 'Revised Terms' }, ...docs.slice(1),
    ]),
    /legal documents changed/i,
  );
});

test('signup preflight fails closed if legal documents become incomplete or unavailable', () => {
  const original = parsePublishedV2LegalDocuments(docs);
  assert.throws(() => assertV2SignupLegalSnapshotCurrent(original, docs.slice(0, 2)), /signup remains closed/i);
  assert.throws(() => assertV2SignupLegalSnapshotCurrent(original, null), /not available/i);
});

test('existing-account legal acceptance preflight rejects changed published text before receipt', () => {
  const reviewed = parsePublishedV2LegalDocuments(docs);
  const changed = [
    docs[0],
    { ...docs[1], content_markdown: 'Revised privacy text without a new digest' },
    docs[2],
  ];
  assert.throws(
    () => assertV2SignupLegalSnapshotCurrent(reviewed, changed),
    /legal documents changed/i,
  );
  assert.deepEqual(
    assertV2SignupLegalSnapshotCurrent(reviewed, docs.map(item => ({ ...item }))),
    reviewed,
  );
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

const completeAccessState = {
  profile: { user_id: 'user-a' },
  required_legal_documents: docs,
  latest_legal_acceptance: {
    terms_version: 'terms-v2',
    privacy_version: 'privacy-v2',
    founder_beta_terms_version: 'founder-v2',
    age_18_confirmed: true,
  },
  onboarding: {
    completed_steps: ['focus', 'training_pattern', 'availability', 'coach', 'food_safety', 'proactivity'],
    skipped_steps: [],
  },
};

function mockAccessClient(
  data: unknown,
  error: Error | null = null,
  sessionUserId: string | null = 'user-a',
): Parameters<typeof resolveV2Access>[0] {
  return {
    rpc: async () => ({ data, error }),
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof resolveV2Access>[0];
}

test('access resolver allows fully verified owner, legal versions and onboarding', async () => {
  const result = await resolveV2Access(mockAccessClient(completeAccessState), { id: 'user-a' });
  assert.equal(result.needsLegalAcceptance, false);
  assert.equal(result.needsOnboarding, false);
  assert.equal(result.requiredLegalDocuments.length, 3);
});

test('access resolver rejects profile ownership mismatch before granting access', async () => {
  await assert.rejects(
    resolveV2Access(mockAccessClient(completeAccessState), { id: 'user-b' }),
    /not ready for this account/i,
  );
});

test('access resolver rejects incomplete published legal data even for the correct owner', async () => {
  const incomplete = { ...completeAccessState, required_legal_documents: docs.slice(0, 2) };
  await assert.rejects(
    resolveV2Access(mockAccessClient(incomplete), { id: 'user-a' }),
    /signup remains closed/i,
  );
});

test('access resolver propagates backend failures rather than treating them as access', async () => {
  await assert.rejects(
    resolveV2Access(mockAccessClient(null, new Error('backend unavailable')), { id: 'user-a' }),
    /backend unavailable/i,
  );
});

test('access resolver refuses an account switched during RPC despite matching returned profile', async () => {
  await assert.rejects(
    resolveV2Access(mockAccessClient(completeAccessState, null, 'user-b'), { id: 'user-a' }),
    /account changed/i,
  );
});

test('access resolver refuses a signed-out session despite matching returned profile', async () => {
  await assert.rejects(
    resolveV2Access(mockAccessClient(completeAccessState, null, null), { id: 'user-a' }),
    /account changed/i,
  );
});

test('onboarding profile read refuses switched session after a matching RPC response', async () => {
  const client = {
    rpc: async () => ({
      data: { profile: { user_id: 'user-a' }, settings: { version: 1 } },
      error: null,
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-b' } } }, error: null }),
    },
  } as unknown as Parameters<typeof readV2OwnedProfileState>[0];
  await assert.rejects(readV2OwnedProfileState(client, 'user-a'), /account changed/i);
});

test('onboarding profile read rejects foreign RPC rows, signed-out and unavailable sessions', async () => {
  const makeClient = (rpcOwner: string, sessionOwner: string | null, sessionError: Error | null = null) => ({
    rpc: async () => ({ data: { profile: { user_id: rpcOwner } }, error: null }),
    auth: {
      getSession: async () => ({
        data: { session: sessionOwner ? { user: { id: sessionOwner } } : null },
        error: sessionError,
      }),
    },
  }) as unknown as Parameters<typeof readV2OwnedProfileState>[0];

  await assert.rejects(readV2OwnedProfileState(makeClient('user-b', 'user-a'), 'user-a'), /account changed/i);
  await assert.rejects(readV2OwnedProfileState(makeClient('user-a', null), 'user-a'), /account changed/i);
  await assert.rejects(readV2OwnedProfileState(makeClient('user-a', 'user-a', new Error('offline')), 'user-a'), /offline/);
});

test('onboarding profile read only returns a matching owner snapshot while session is active', async () => {
  const state = { profile: { user_id: 'user-a' }, settings: { version: 4 } };
  const client = {
    rpc: async () => ({ data: state, error: null }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-a' } } }, error: null }),
    },
  } as unknown as Parameters<typeof readV2OwnedProfileState>[0];
  assert.deepEqual(await readV2OwnedProfileState(client, 'user-a'), state);
});

test('canceled onboarding profile reads discard delayed RPC results without consulting the session', async () => {
  let resolveRpc: ((value: { data: unknown; error: null }) => void) | undefined;
  let sessionChecks = 0;
  let active = true;
  const client = {
    rpc: () => new Promise(resolve => { resolveRpc = resolve; }),
    auth: {
      getSession: async () => {
        sessionChecks += 1;
        return { data: { session: { user: { id: 'user-a' } } }, error: null };
      },
    },
  } as unknown as Parameters<typeof readV2OwnedProfileState>[0];

  const pending = readV2OwnedProfileState(client, 'user-a', () => active);
  active = false;
  resolveRpc?.({ data: { profile: { user_id: 'user-a' } }, error: null });
  await assert.rejects(pending, /no longer active/i);
  assert.equal(sessionChecks, 0);
});

test('canceled onboarding profile reads discard delayed session-check results', async () => {
  let releaseSession: ((value: { data: unknown; error: null }) => void) | undefined;
  let active = true;
  const client = {
    rpc: async () => ({ data: { profile: { user_id: 'user-a' } }, error: null }),
    auth: {
      getSession: () => new Promise(resolve => { releaseSession = resolve; }),
    },
  } as unknown as Parameters<typeof readV2OwnedProfileState>[0];

  const pending = readV2OwnedProfileState(client, 'user-a', () => active);
  await Promise.resolve();
  await Promise.resolve();
  active = false;
  releaseSession?.({ data: { session: { user: { id: 'user-a' } } }, error: null });
  await assert.rejects(pending, /no longer active/i);
});
