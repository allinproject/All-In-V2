import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appliedFoundation,auditAppliedMigrations} from './check-v2-applied-migration-integrity.mjs';

const base=[
 ['20261110000000_first.sql',createHash('sha256').update('select 1;').digest('hex')],
 ['20261110000001_second.sql',createHash('sha256').update('select 2;').digest('hex')],
];
const read=name=>name==='20261110000000_first.sql'?'select 1;':'select 2;';

test('baseline corresponds to the 18 recorded deployed V2 migrations',()=>{
 assert.equal(appliedFoundation.length,18);
 assert.equal(new Set(appliedFoundation.map(x=>x[0])).size,18);
 assert.ok(appliedFoundation.every(([n,hash])=>
   /^\d{14}_[a-z0-9_]+\.sql$/.test(n)&&/^[a-f0-9]{64}$/.test(hash)));
});
test('exact source matches pass, and newer staged migrations remain separate',()=>{
 assert.deepEqual(auditAppliedMigrations([...base.map(x=>x[0]),'20261112010000_future.sql'],read,base),{
  ok:true,problems:[],appliedCount:2,
 });
});
test('missing, modified or renamed historical SQL fails closed',()=>{
 let out=auditAppliedMigrations([base[0][0]],read,base);
 assert.equal(out.ok,false);
 assert.match(out.problems.join(';'),/Missing applied migration/);
 out=auditAppliedMigrations(base.map(x=>x[0]),name=>
   name===base[0][0]?'select 3;':read(name),base);
 assert.equal(out.ok,false);
 assert.match(out.problems.join(';'),/contents changed/);
 out=auditAppliedMigrations([...base.map(x=>x[0]),'20261110000000_duplicate.sql'],read,base);
 assert.equal(out.ok,false);
 assert.match(out.problems.join(';'),/Unrecorded historical migration/);
});

test('rejects duplicate future migration versions and malformed names',()=>{
 const names=[...base.map(x=>x[0]),'20261112010000_next.sql','20261112010000_collision.sql'];
 let result=auditAppliedMigrations(names,read,base);
 assert.equal(result.ok,false);
 assert.match(result.problems.join(';'),/Duplicate migration version/);
 result=auditAppliedMigrations([...base.map(x=>x[0]),'unversioned.sql'],read,base);
 assert.equal(result.ok,false);
 assert.match(result.problems.join(';'),/Invalid migration filename/);
});
