import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const script = readFileSync(fileURLToPath(new URL('./prepare-v2-lockfile.ps1', import.meta.url)), 'utf8');

test('Windows lockfile helper restricts branch and protects local package changes', () => {
  assert.match(script, /integration\/v2-foundation/);
  assert.match(script, /git -C \$repoRoot branch --show-current/);
  assert.match(script, /git -C \$repoRoot status --porcelain/);
  assert.match(script, /if \(Test-Path \$lockPath\)/);
  assert.match(script, /Refusing to prepare a V2 lockfile outside/);
});

test('Windows helper fails closed without committing, pushing or deploying', () => {
  assert.match(script, /\$ErrorActionPreference = 'Stop'/);
  assert.match(script, /Set-StrictMode -Version Latest/);
  assert.match(script, /if \(\$LASTEXITCODE -ne 0\)/);
  assert.doesNotMatch(script, /^\s*(?:&\s*)?(?:git|gh|supabase|eas)(?:\.exe|\.cmd)?\s+(?:push|commit|deploy|release|pr\s+create)\b/im);
  assert.match(script, /Pop-Location/);
});

test('Windows checkpoint validates genuine lockfile, clean install, tests and TypeScript in order', () => {
  const steps = [
    "'Resolve canonical npm lockfile'",
    "'Validate exact lockfile contract'",
    "'Verify reproducible clean install'",
    "'Auth tests'",
    "'Cookbook tests'",
    "'Training tests'",
    "'TypeScript check'",
  ];
  let pos = 0;
  for (const step of steps) {
    const next = script.indexOf(step, pos);
    assert.ok(next >= pos, `Missing or out-of-order checkpoint: ${step}`);
    pos = next + step.length;
  }
  assert.match(script, /'install', '--package-lock-only', '--ignore-scripts'/);
  assert.match(script, /'--require-lockfile'/);
  assert.match(script, /'ci', '--no-audit', '--no-fund'/);
  assert.doesNotMatch(script, /--force|--legacy-peer-deps/);
});
