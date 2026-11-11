import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const runner=fileURLToPath(new URL('../supabase/tests/all217_local_owner_replay.cjs',import.meta.url));
const failBeforeConnection=(url,marker)=>{
 const env={...process.env,ALL217_TEST_DATABASE_URL:url,
   ALL217_ISOLATED_TEST_DB:marker};
 const r=spawnSync(process.execPath,[runner],{env,encoding:'utf8',timeout:10000});
 assert.notEqual(r.status,0);
 assert.match((r.stderr||'')+(r.stdout||''),/Refusing Coach SQL replay/);
 assert.doesNotMatch((r.stderr||'')+(r.stdout||''),/Cannot find module 'pg'/);
};
test('Coach SQL replay is opt-in even on local test DB',()=>{
 failBeforeConnection('postgres://u:p@127.0.0.1:5432/allin_v2_coach_test','');
});
test('Coach SQL replay rejects production and external hosts before driver load',()=>{
 failBeforeConnection('postgres://u:p@db.example.com:5432/allin_v2_coach_test','YES_DISPOSABLE');
 failBeforeConnection('postgres://u:p@127.0.0.1:5432/postgres','YES_DISPOSABLE');
 failBeforeConnection('postgres://u:p@127.0.0.1:5432/allin_v2','YES_DISPOSABLE');
});
test('Coach SQL replay rejects URL queries or other protocols',()=>{
 failBeforeConnection('postgres://u:p@localhost:5432/allin_v2_coach_test?sslmode=require','YES_DISPOSABLE');
 failBeforeConnection('https://localhost/allin_v2_coach_test','YES_DISPOSABLE');
});
