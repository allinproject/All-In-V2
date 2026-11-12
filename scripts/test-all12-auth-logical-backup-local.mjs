// ALL-12: local-only Auth schema logical backup coverage.
// This proves the real pg_dump archive includes Auth users and identities;
// it does NOT prove hosted Auth config, signing secrets or restore acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert(['1','true'].includes(process.env.CI??''),'Disposable CI required');
const db=process.argv[2];
assert.match(db??'',/^[a-f0-9]{12,64}$/);
const local=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')[0];
assert.equal(db,local,'Refusing non-local Supabase DB');
const run=args=>execFileSync('docker',['exec',db,...args],{encoding:'utf8',timeout:120000});
const file='/tmp/all12-auth-logical.dump';
const required=['users','identities','sessions','refresh_tokens'];
const sql="SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='auth' ORDER BY tablename";
const actual=new Set(run(['psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql]).trim().split('\n'));
for(const table of required)assert(actual.has(table),'Missing Auth table: '+table);
try {
 run(['pg_dump','-U','postgres','-d','postgres','-Fc','--data-only','-n','auth','-f',file]);
 const toc=run(['pg_restore','-l',file]);
 const included=new Set(toc.split('\n').map(line=>{
  const m=line.match(/; \d+ \d+ TABLE DATA auth ([a-z_]+) /);
  return m?.[1];
 }).filter(Boolean));
 const missing=[...actual].filter(t=>!included.has(t));
 assert.deepEqual(missing,[],'Auth tables omitted from actual logical archive');
 console.log('PASS ALL-12: '+included.size+' Auth tables in real local logical archive including users, identities, sessions, refresh_tokens; restore/config still gated');
} finally {
 try{run(['rm','-f',file]);}catch{}
}
