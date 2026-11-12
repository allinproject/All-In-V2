import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readWorkflow = name => readFileSync(resolve(root, '.github/workflows', name), 'utf8');
const engineering = readWorkflow('v2-engineering.yml');
const smoke = readWorkflow('v2-auth-smoke.yml');
const triggers = workflow => {
  const match = workflow.match(/^on:\n([\s\S]*?)(?=^permissions:|^concurrency:|^jobs:)/m);
  assert.ok(match, 'Workflow must declare explicit event triggers');
  return match[1];
};

test('paid V2 engineering validation cannot run automatically on integration push or draft PR', () => {
  const events = triggers(engineering);
  // A targeted, workflow-file-only push may validate edits to this CI
  // workflow. Ordinary integration source pushes must never run full builds.
  if (/^  push:/m.test(events)) {
    const pushBlock=events.match(/^  push:\n([\s\S]*?)(?=^  (?:pull_request|workflow_dispatch|schedule|repository_dispatch|workflow_run):)/m);
    assert.ok(pushBlock,'Engineering push trigger must be bounded');
    assert.match(pushBlock[1], /branches: \[integration\/v2-foundation\]/);
    assert.match(pushBlock[1], /paths:\n\s+- '\.github\/workflows\/v2-engineering\.yml'/);
    const allowedPaths=[...pushBlock[1].matchAll(/^\s+- '([^']+)'/gm)].map(m=>m[1]);
    assert.deepEqual(allowedPaths,['.github/workflows/v2-engineering.yml'],
      'Engineering push must be restricted to its own workflow file');
  }
  assert.match(events, /^  pull_request:/m);
  assert.match(events, /ready_for_review/);
  assert.match(events, /^  workflow_dispatch:/m);
  assert.match(engineering, /if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false/);
  assert.match(engineering, /cancel-in-progress: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}/);
});

test('full V2 review gate requires committed lock and complete acceptance without deploying', () => {
  for (const check of [
    'check-v2-supabase-target.mjs',
    'check-v2-dependency-manifest.mjs --require-lockfile',
    'npm ci --no-audit --no-fund',
    'npm run lint',
    'lint-v2-source.test.mjs',
    'npm run test:auth',
    'npm run test:calculator',
    'npm run test:training-logic',
    'npm run typecheck',
    'expo config --type public',
  ]) assert.ok(engineering.includes(check), `Missing full CI gate: ${check}`);
  // Bundles may be exported together or separately, but never skip a
  // platform to satisfy the review gate.
  const combined = engineering.includes('expo export --platform all');
  const perPlatform = engineering.includes('expo export --platform ios') &&
    engineering.includes('expo export --platform android');
  assert.ok(combined || perPlatform,
    'Missing full CI gate: both Expo iOS and Android exports required');
  assert.doesNotMatch(engineering, /npm install --package-lock-only|npm ci --legacy-peer-deps|npm ci --force/);
  assert.match(engineering, /contents: read/);
  assert.doesNotMatch(engineering, /\bsupabase\s+(db\s+push|functions\s+deploy|migration\s+up)\b/);
});

test('small V2 smoke remains dependency-free, narrow, and runs the cost-policy contract', () => {
  const events = triggers(smoke);
  assert.match(events, /^  push:/m);
  assert.match(events, /integration\/v2-foundation/);
  assert.match(events, /check-v2-ci-cost-policy\.test\.mjs/);
  assert.match(smoke, /node --test \.\.\/\.\.\/scripts\/check-v2-ci-cost-policy\.test\.mjs/);
  assert.match(smoke, /timeout-minutes: 5/);
  assert.match(smoke, /contents: read/);
  assert.doesNotMatch(smoke, /npm ci|npm install|expo export|supabase db push/);
});
