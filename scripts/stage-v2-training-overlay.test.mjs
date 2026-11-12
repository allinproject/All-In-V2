import test from 'node:test';
import assert from 'node:assert/strict';
import {stripCandidateTransactionWrappers,stageOverlay} from './stage-v2-training-overlay.mjs';

test('strips only standalone top-level transaction wrappers',()=>{
 const text="-- standalone SQL\nBEGIN;\nCREATE TABLE public.test_a(id int);\nCOMMIT;\nDO $$ BEGIN RAISE NOTICE 'kept'; END $$;\n";
 const result=stripCandidateTransactionWrappers(text,'one.sql');
 assert.equal(result.removed,2);
 assert.match(result.sql,/CREATE TABLE public\.test_a/);
 assert.match(result.sql,/DO \$\$ BEGIN RAISE NOTICE/);
 assert.doesNotMatch(result.sql,/^BEGIN;|^COMMIT;/m);
});
test('rejects orphan COMMIT, nested BEGIN, and an unmatched BEGIN',()=>{
 assert.throws(()=>stripCandidateTransactionWrappers('COMMIT;','bad.sql'),/COMMIT without/);
 assert.throws(()=>stripCandidateTransactionWrappers('BEGIN;\nBEGIN;\nCOMMIT;','bad.sql'),/nested/);
 assert.throws(()=>stripCandidateTransactionWrappers('BEGIN;','bad.sql'),/unclosed/);
 assert.throws(()=>stripCandidateTransactionWrappers('ROLLBACK;','bad.sql'),/unexpected internal ROLLBACK/);
});
test('stages the actual ordered SQL inputs once, no duplicate or lost definitions',()=>{
 const names=Array.from({length:30},(_,i)=>'candidate'+i+'.sql');
 const overlay=names.map(x=>'\\i /tmp/allin/docs/architecture/sql/'+x).join('\n');
 const staged=new Map();
 const result=stageOverlay(overlay,()=> 'BEGIN;\nCREATE TABLE some_table(id integer);\nCOMMIT;',
   (name,sql)=>staged.set(name,sql));
 assert.deepEqual(result,{files:30,removed:60});
 assert.equal(staged.size,30);
 assert.ok([...staged.values()].every(sql=>sql.includes('CREATE TABLE some_table')));
 assert.throws(()=>stageOverlay(overlay+'\n\\i /tmp/allin/docs/architecture/sql/candidate0.sql',
   ()=>'',()=>{}),/unique ordered/);
});
