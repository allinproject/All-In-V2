import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [
  'scripts/check-v2-supabase-target.mjs',
  'supabase/config.toml',
  'apps/mobile-v2/.env.example',
];

function runGuard(changes = {}, runtimeUrl) {
  const directory = mkdtempSync(resolve(tmpdir(), 'allin-v2-target-'));
  try {
    for (const file of files) {
      const target = resolve(directory, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, changes[file] ?? readFileSync(resolve(root, file), 'utf8'));
    }
    const env = { ...process.env };
    delete env.EXPO_PUBLIC_SUPABASE_URL;
    if (runtimeUrl !== undefined) env.EXPO_PUBLIC_SUPABASE_URL = runtimeUrl;
    return spawnSync(process.execPath, [resolve(directory, files[0])], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const cfg = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
const template = readFileSync(resolve(root, 'apps/mobile-v2/.env.example'), 'utf8');

test('accepts exact V2 configuration and runtime URL', () => {
  const result = runGuard({}, 'https://xarhuczrtzuiljmtdaeu.supabase.co');
  assert.equal(result.status, 0, result.stderr);
});

test('rejects V1 project ID', () => {
  const result = runGuard({ 'supabase/config.toml': cfg.replace('xarhuczrtzuiljmtdaeu', 'impulecgsgaruvniuttc') });
  assert.notEqual(result.status, 0);
});

test('rejects V1 app URL', () => {
  const result = runGuard({ 'apps/mobile-v2/.env.example': template.replace('xarhuczrtzuiljmtdaeu', 'impulecgsgaruvniuttc') });
  assert.notEqual(result.status, 0);
});

test('rejects duplicate Supabase project declarations', () => {
  const result = runGuard({ 'supabase/config.toml': cfg + '\nproject_id = "xarhuczrtzuiljmtdaeu"\n' });
  assert.notEqual(result.status, 0);
});

test('rejects privileged EXPO_PUBLIC secret names', () => {
  const result = runGuard({ 'apps/mobile-v2/.env.example': template + '\nEXPO_PUBLIC_SERVICE_ROLE_KEY=unsafe\n' });
  assert.notEqual(result.status, 0);
});

test('rejects V1 runtime URL override', () => {
  const result = runGuard({}, 'https://impulecgsgaruvniuttc.supabase.co');
  assert.notEqual(result.status, 0);
});
