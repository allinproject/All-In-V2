import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const file=fileURLToPath(new URL('../../../../../scripts/test-all251-community-photo-two-auth-local.mjs',import.meta.url));
const source=readFileSync(file,'utf8');

test('real Community photo fixture syntax is valid, but never executes in regular CI',()=>{
 const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:10000});
 assert.equal(syntax.status,0,syntax.stderr);
});
test('acceptance requires explicit disposable localhost Supabase and rejects hosted operation',()=>{
 assert.match(source,/assert\.equal\(process\.env\.CI,'1'/);
 assert.match(source,/assert\.notEqual\(process\.env\.ALL251_ALLOW_HOSTED_TEST,'true'/);
 assert.match(source,/assert\.equal\(base\.protocol,'http:'\)/);
 assert.match(source,/assert\.equal\(base\.port,'54321'\)/);
 assert.match(source,/localhost/);
 assert.match(source,/storageTransport=createLocalDeletionStorageTransport/);
 assert.doesNotMatch(source,/https:\/\/.*supabase\.co/);
 assert.doesNotMatch(source,/ALLIN_PRIVATE_WRITER_ACCEPTED\s*=\s*true/);
});
test('photo acceptance must use real two-user Auth, exact digest and byte absence, then clean up',()=>{
 assert.match(source,/\/auth\/v1\/admin\/users/);
 assert.match(source,/\/auth\/v1\/token\?grant_type=password/);
 assert.match(source,/storage\/v1\/object\/authenticated/);
 assert.match(source,/objectBytesAbsent/);
 assert.match(source,/createHash\('sha256'\)/);
 assert.match(source,/readFileSync\(backup\)/);
 assert.match(source,/DELETE','\/storage\/v1\/object/);
 assert.match(source,/DROP POLICY IF EXISTS/);
 assert.match(source,/auth_cleanup/);
 assert.match(source,/if\(accepted\)console\.log/);
});
test('fixture must not grant public reads, invent Community media storage routes or enable production',()=>{
 assert.match(source,/public:false/);
 assert.match(source,/FOR SELECT TO authenticated/);
 assert.match(source,/split_part\(name,'\/',1\)/);
 assert.doesNotMatch(source,/CREATE POLICY.*FOR INSERT/s);
 assert.doesNotMatch(source,/on:\s*push/);
});
