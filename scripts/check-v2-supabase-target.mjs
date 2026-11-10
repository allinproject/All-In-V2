import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run from any working directory; the source file sits under <repo>/scripts/.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const V2_REF = 'xarhuczrtzuiljmtdaeu';
const V1_REF = 'impulecgsgaruvniuttc';

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}
function onlyLine(source, key) {
  const matches = source.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(`${key}=`));
  assert.equal(matches.length, 1, `Expected exactly one ${key} entry`);
  return matches[0].slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

const config = read('supabase/config.toml');
const template = read('apps/mobile-v2/.env.example');
const project = config.match(/^project_id\s*=\s*"([a-z0-9]+)"\s*$/m);
assert.ok(project, 'Supabase config must contain one quoted project_id');
assert.equal((config.match(/^project_id\s*=/gm) || []).length, 1, 'Supabase config must have one project_id');
assert.equal(project[1], V2_REF, 'Refusing a non-V2 Supabase project in config.toml');

const templateUrl = onlyLine(template, 'EXPO_PUBLIC_SUPABASE_URL');
assert.equal(templateUrl, `https://${V2_REF}.supabase.co`, 'V2 app example must target the V2 Supabase project');
assert.ok(!config.includes(V1_REF) && !template.includes(V1_REF), 'V1 Supabase ref must not appear in V2 configuration');
assert.ok(!/^EXPO_PUBLIC_.*(?:SERVICE_ROLE|SECRET|PRIVATE_KEY)\s*=/mi.test(template), 'Do not expose privileged secrets via EXPO_PUBLIC_ keys');

if (process.env.EXPO_PUBLIC_SUPABASE_URL) {
  assert.equal(process.env.EXPO_PUBLIC_SUPABASE_URL.trim(), templateUrl, 'Refusing to run with a non-V2 public Supabase URL');
}
console.log('PASS: V2 Supabase project guard (config, public template, optional runtime URL)');
