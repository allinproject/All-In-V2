import test from 'node:test';
import assert from 'node:assert/strict';
import {stripCandidateTransactionWrappers,stageOverlay} from './stage-v2-training-overlay.mjs';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

test('strips only standalone file-level transaction wrappers',()=>{
 const sql=[
  '-- source-only SQL',
  'BEGIN;',
  'CREATE TABLE public.test_a(id int);',
  'COMMIT;',
  "DO $$ BEGIN RAISE NOTICE 'kept'; END $$;",
  '',
 ].join('\n');
 const result=stripCandidateTransactionWrappers(sql,'one.sql');
 assert.equal(result.removed,2);
 assert.match(result.sql,/CREATE TABLE public\.test_a/);
 assert.match(result.sql,/DO \$\$ BEGIN RAISE NOTICE/);
 assert.doesNotMatch(result.sql,/^BEGIN;|^COMMIT;/m);
});

test('preserves standalone BEGIN inside named and unnamed PL/pgSQL dollar quotes',()=>{
 const sql=[
  'BEGIN;',
  'CREATE FUNCTION public.example() RETURNS void LANGUAGE plpgsql AS $fn$',
  'BEGIN;',
  "  RAISE NOTICE 'executing';",
  'END;',
  '$fn$;',
  'DO $$',
  'BEGIN;',
  " RAISE NOTICE 'DO body';",
  'END;',
  '$$;',
  'COMMIT;',
 ].join('\n');
 const result=stripCandidateTransactionWrappers(sql,'funcs.sql');
 assert.equal(result.removed,2);
 assert.equal((result.sql.match(/^BEGIN;$/gm)||[]).length,2);
 assert.match(result.sql,/AS \$fn\$\nBEGIN;/);
 assert.match(result.sql,/DO \$\$\nBEGIN;/);
});

test('rejects orphan COMMIT, nested BEGIN, unmatched BEGIN and file-level ROLLBACK',()=>{
 assert.throws(()=>stripCandidateTransactionWrappers('COMMIT;','bad.sql'),/COMMIT without/);
 assert.throws(()=>stripCandidateTransactionWrappers('BEGIN;\nBEGIN;\nCOMMIT;','bad.sql'),/nested/);
 assert.throws(()=>stripCandidateTransactionWrappers('BEGIN;','bad.sql'),/unclosed/);
 assert.throws(()=>stripCandidateTransactionWrappers('ROLLBACK;','bad.sql'),/unexpected internal ROLLBACK/);
});

test('fails closed on unterminated dollar-quoted function bodies',()=>{
 assert.throws(
  ()=>stripCandidateTransactionWrappers('BEGIN;\nDO $body$\nBEGIN;\nCOMMIT;','broken.sql'),
  /unterminated dollar-quoted/);
});

test('stages exact ordered overlay inputs without duplicating or losing SQL',()=>{
 const names=Array.from({length:30},(_,i)=>'candidate'+i+'.sql');
 const overlay=names.map(x=>'\\i /tmp/allin/docs/architecture/sql/'+x).join('\n');
 const staged=new Map();
 const result=stageOverlay(overlay,
  ()=>'BEGIN;\nCREATE TABLE some_table(id integer);\nCOMMIT;',
  (name,sql)=>staged.set(name,sql));
 assert.deepEqual(result,{files:30,removed:60});
 assert.equal(staged.size,30);
 assert.ok([...staged.values()].every(sql=>sql.includes('CREATE TABLE some_table')));
 assert.throws(()=>stageOverlay(
  overlay+'\n\\i /tmp/allin/docs/architecture/sql/candidate0.sql',
  ()=>'',()=>{}),/unique ordered/);
});

test('all 30 checked-in candidate SQL files stage atomically without changing source',()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const overlay=readFileSync(resolve(root,'scripts/test-v2-foundation-training-overlay-postgres.psql'),'utf8');
 const staged=new Map();
 const result=stageOverlay(
  overlay,
  name=>readFileSync(resolve(root,'docs/architecture/sql',name),'utf8'),
  (name,sql)=>staged.set(name,sql)
 );
 assert.equal(result.files,30);
 assert.equal(staged.size,30);
 assert.ok(result.removed>=10,'Expected existing file transaction wrappers to be removed');
 const first=staged.get('V2-TRAINING-COMPLETED-IDENTITY-OWNER-CANDIDATE.sql');
 assert.ok(first,'Canonical identity owner must be in the overlay');
 assert.match(first,/CREATE TABLE public\.v2_training_session_instances/);
 assert.doesNotMatch(first,/^BEGIN;$/m);
 assert.doesNotMatch(first,/^COMMIT;$/m);
});
