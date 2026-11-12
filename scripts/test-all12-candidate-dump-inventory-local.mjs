// ALL-12: prove every actual V2 candidate table is represented in a logical
// backup TOC. This is NOT populated restore acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {recoveryDomains,findUntrackedRecoveryTables} from './all12-recovery-domain-manifest.mjs';
assert(['1','true'].includes(process.env.CI??''),'Disposable CI required');
const db=process.argv[2];
assert.match(db??'',/^[a-f0-9]{12,64}$/);
const local=execFileSync('docker',['ps','--filter','name=supabase_db_','--format','{{.ID}}'],{encoding:'utf8'}).trim().split('\n')[0];
assert.equal(db,local,'Refusing non-local DB');
const run=(args)=>execFileSync('docker',['exec',db,...args],{encoding:'utf8',timeout:120000});
const sql="SELECT n.nspname||'.'||c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p') AND left(c.relname,3)='v2_' ORDER BY 1;";
const tables=run(['psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql]).trim().split('\n').filter(Boolean);
assert(tables.length>0,'No V2 tables found');
assert.deepEqual(findUntrackedRecoveryTables(tables),[],'Unclassified candidate table');
const file='/tmp/all12-candidate-inventory.dump';
try {
 run(['pg_dump','-U','postgres','-d','postgres','-Fc','--data-only',...tables.flatMap(t=>['-t',t]),'-f',file]);
 const toc=run(['pg_restore','-l',file]);
 const entries=new Set(toc.split('\n').filter(x=>/; .* TABLE DATA /.test(x)).map(line=>{
  const match=line.match(/; \d+ \d+ TABLE DATA (public|allin_private) (v2_[a-z0-9_]+) /);
  return match?match[1]+'.'+match[2]:null;
 }).filter(Boolean));
 const missing=tables.filter(t=>!entries.has(t));
 assert.deepEqual(missing,[],'V2 table omitted from logical backup TOC');
 const owned=new Set(recoveryDomains.flatMap(d=>d.tables));
 assert(tables.every(t=>owned.has(t)));
 console.log('PASS ALL-12: '+tables.length+' actual disposable V2 tables present in logical backup TOC; populated restore remains separately gated');
} finally {
 try {run(['rm','-f',file]);}catch{}
}
