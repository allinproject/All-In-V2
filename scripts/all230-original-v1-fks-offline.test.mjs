import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const ddl=readFileSync(new URL('supabase/tests/all230_v1_original_17_fk_offline_candidate.sql',root),'utf8');
const guard=readFileSync(new URL('scripts/all230-restore-v1-original-fks-offline.sh',root),'utf8');
test('exactly 17 original V1 foreign keys, atomically and without identity stubs',()=>{
 const alters=ddl.match(/^ALTER TABLE .* ADD CONSTRAINT .* FOREIGN KEY .*;$/gm)??[];
 assert.equal(alters.length,17);
 assert.match(ddl,/^BEGIN;$/m);
 assert.match(ddl,/^COMMIT;$/m);
 assert.equal((ddl.match(/REFERENCES auth\.users\(id\)/g)??[]).length,10);
 assert.match(ddl,/REFERENCES allin_profile_goals\(id\)/);
 assert.doesNotMatch(ddl,/\b(CREATE|INSERT|UPDATE|DELETE|DROP|DISABLE)\s+(?:TABLE|INTO|FROM|TRIGGER|ROW|CONSTRAINT)\b/i);
});
test('operator restoration refuses connected, unauthorized and unproven Auth state',()=>{
 assert.match(guard,/HostConfig\.NetworkMode/);
 assert.match(guard,/HostConfig\.PortBindings/);
 assert.match(guard,/HostConfig\.Tmpfs/);
 assert.match(guard,/auth\.users/);
 assert.match(guard,/auth\.identities/);
 assert.match(guard,/auth\.sessions/);
 assert.match(guard,/ALL230_GENUINE_AUTH_SOURCE_REVIEW_APPROVED/);
 assert.match(guard,/ALL230_OFFLINE_FK_INSTALL_APPROVED/);
 assert.match(guard,/ON_ERROR_STOP=1/);
 assert.match(guard,/cb8a4806420ab2b409bef8736678ff59/);
 assert.doesNotMatch(guard,/\b(createuser|docker run|pg_dump|supabase db reset)\b/);
});
