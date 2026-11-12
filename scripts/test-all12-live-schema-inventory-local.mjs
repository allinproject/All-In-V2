// ALL-12: compare actual disposable Postgres schema to recovery manifest.
// Refuse undeclared application tables, including newly introduced domains.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {findUntrackedRecoveryTables,recoveryDomains} from './all12-recovery-domain-manifest.mjs';
assert(['1','true'].includes(process.env.CI),'Disposable CI mode required');
const db=process.argv[2];
assert.match(db??'',/^[a-f0-9]{12,64}$/);
const local=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')[0];
assert.equal(db,local,'Only disposable local Supabase PostgreSQL is allowed');
const sql=`SELECT n.nspname||'.'||c.relname FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p')
 AND c.relname LIKE 'v2\\_%' ESCAPE '\\'
 ORDER BY 1;`;
const actual=execFileSync('docker',['exec','-i',db,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const untracked=findUntrackedRecoveryTables(actual);
if(untracked.length){
 console.error('FAIL ALL-12: undeclared V2 application tables:',untracked.join(', '));
 process.exit(1);
}
const declared=new Set(recoveryDomains.flatMap(d=>d.tables));
const tracked=actual.filter(t=>declared.has(t));
console.log(`PASS ALL-12: live disposable PostgreSQL recovery inventory tracks ${tracked.length}/${actual.length} V2 application tables`);
