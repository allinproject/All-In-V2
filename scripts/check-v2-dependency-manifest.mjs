import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/mobile-v2');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const react = pkg.dependencies?.react;
const reactDom = pkg.dependencies?.['react-dom'];
if (!/^\d+\.\d+\.\d+$/.test(react ?? '') || react !== reactDom) {
  throw new Error('V2 React and React DOM must use the same exact pinned version.');
}

if (process.argv.includes('--require-lockfile')) {
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const packageRoot = lock.packages?.[''];
  if (lock.lockfileVersion !== 3 || lock.name !== pkg.name || packageRoot?.name !== pkg.name || packageRoot?.version !== pkg.version) {
    throw new Error('V2 lockfile does not match the package identity or npm lockfile v3 format.');
  }
  for (const field of ['dependencies', 'devDependencies']) {
    const expected = pkg[field] ?? {};
    const actual = packageRoot[field] ?? {};
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected).sort())) {
      throw new Error(`V2 lockfile root ${field} differs from package.json; regenerate and review locally.`);
    }
  }
  if (lock.packages?.['node_modules/react']?.version !== react || lock.packages?.['node_modules/react-dom']?.version !== reactDom) {
    throw new Error('V2 lockfile resolved React versions do not match pinned versions.');
  }
}
console.log('V2 dependency manifest contract PASS');
