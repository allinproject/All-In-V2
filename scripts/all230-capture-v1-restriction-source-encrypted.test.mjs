import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./all230-capture-v1-restriction-source-encrypted.sh',import.meta.url));
const source=readFileSync(script,'utf8');
const run=(overrides={})=>spawnSync('bash',[script],{
 encoding:'utf8',timeout:10000,
 env:{PATH:process.env.PATH,HOME:process.env.HOME,CI:'1',
 ALL230_V1_CAPTURE_APPROVED:'YES',
 ALL230_V1_SOURCE_PROJECT_REF:'impulecgsgaruvniuttc',
 ...overrides},
});
test('V1 capture cannot run in CI even when explicitly approved',()=>{
 const result=run();
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Refusing CI source export/);
});
test('missing explicit approval or wrong project fails before connecting',()=>{
 for(const vars of [
  {CI:'',ALL230_V1_CAPTURE_APPROVED:''},
  {CI:'',ALL230_V1_SOURCE_PROJECT_REF:'xarhuczrtzuiljmtdaeu'},
  {CI:'',ALL230_V1_SECURE_CUSTODY_APPROVED:''},
 ]) {
  const result=run(vars);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/approval required|Wrong V1 source project|required/i);
  assert.doesNotMatch(result.stdout,/CAPTURED/);
 }
});
test('capture must never persist a plaintext dump or publish to GitHub',()=>{
 assert.match(source,/set -euo pipefail/);
 assert.match(source,/umask 077/);
 assert.match(source,/PGSSLMODE:-.*verify-full/);
 assert.match(source,/PGOPTIONS='-c default_transaction_read_only=on' pg_dump/);
 assert.match(source,/pg_dump "\$\{argv\[@\]\}" \|\s*\n\s*age -r/);
 assert.match(source,/\$temp/);
 assert.match(source,/sha256sum "\$temp"/);
 assert.match(source,/ln -- "\$temp" "\$encrypted"/);
 assert.match(source,/success=YES/);
 assert.doesNotMatch(source,/pg_dump[^\n]*--file=/);
 assert.doesNotMatch(source,/--dbname=postgresql:\/\//);
 assert.match(source,/scopeExhaustive":false/);
 assert.match(source,/initialCertificationAuthorized":false/);
});
test('exact eleven reviewed source tables only; never exports auth, storage, vault or secrets',()=>{
 const match=source.match(/tables=\(\s*([\s\S]*?)\s*\)/);
 assert(match);
 const list=match[1].trim().split(/\s+/);
 assert.deepEqual(list,[
  'public.allin_training','public.allin_training_plan_versions',
  'public.allin_training_sessions','public.allin_workout_user_overrides',
  'public.allin_workout_plan_links','public.allin_coach_learnings',
  'public.allin_coach_thread_facts','public.allin_coach_thread_state',
  'public.allin_coaching_records','public.allin_workout_sync_sources',
  'public.allin_backup_restore_drills',
 ]);
 assert(list.every(t=>t.startsWith('public.allin_')));
});
