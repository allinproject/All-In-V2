import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(resolve(root, 'scripts/check-v2-dependency-manifest.mjs'), 'utf8');
const packageTemplate = JSON.parse(readFileSync(resolve(root, 'apps/mobile-v2/package.json'), 'utf8'));

function validate({ mutatePackage = pkg => pkg, mutateLock = lock => lock, requireLock = true } = {}) {
  const folder = mkdtempSync(resolve(tmpdir(), 'allin-v2-deps-'));
  try {
    const scriptPath = resolve(folder, 'scripts/check-v2-dependency-manifest.mjs');
    const packagePath = resolve(folder, 'apps/mobile-v2/package.json');
    const lockPath = resolve(folder, 'apps/mobile-v2/package-lock.json');
    mkdirSync(dirname(scriptPath), { recursive: true });
    mkdirSync(dirname(packagePath), { recursive: true });
    writeFileSync(scriptPath, source);
    const pkg = mutatePackage(structuredClone(packageTemplate));
    writeFileSync(packagePath, JSON.stringify(pkg));
    const lock = {
      name: pkg.name,
      version: pkg.version,
      lockfileVersion: 3,
      packages: {
        '': { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies },
        'node_modules/react': { version: pkg.dependencies.react },
        'node_modules/react-dom': { version: pkg.dependencies['react-dom'] },
      },
    };
    writeFileSync(lockPath, JSON.stringify(mutateLock(lock)));
    return spawnSync(process.execPath, [scriptPath, ...(requireLock ? ['--require-lockfile'] : [])], { encoding: 'utf8', timeout: 5000 });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test('accepts a matching exact React/React DOM manifest', () => {
  const result = validate({ requireLock: false });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects mismatched React/React DOM versions', () => {
  const result = validate({ mutatePackage: p => ({ ...p, dependencies: { ...p.dependencies, 'react-dom': '19.3.1' } }), requireLock: false });
  assert.notEqual(result.status, 0);
});

test('rejects a version range instead of an exact React pin', () => {
  const result = validate({ mutatePackage: p => ({ ...p, dependencies: { ...p.dependencies, react: '^19.3.0', 'react-dom': '^19.3.0' } }), requireLock: false });
  assert.notEqual(result.status, 0);
});

test('accepts a matching npm v3 lockfile contract', () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a lockfile with stale direct dependencies', () => {
  const result = validate({ mutateLock: lock => { lock.packages[''].dependencies['react-dom'] = '19.3.1'; return lock; } });
  assert.notEqual(result.status, 0);
});

test('rejects resolved React DOM version drift', () => {
  const result = validate({ mutateLock: lock => { lock.packages['node_modules/react-dom'].version = '19.3.1'; return lock; } });
  assert.notEqual(result.status, 0);
});

test('rejects a lockfile from a different package', () => {
  const result = validate({ mutateLock: lock => { lock.name = 'some-other-app'; return lock; } });
  assert.notEqual(result.status, 0);
});
