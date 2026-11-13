// ALL-12: disposable, network-isolated V2 migration replay.
// Uses approved existing 18-migration digest ledger. Never touches live Supabase,
// the verified real-source restore, or any existing database. Does NOT configure
// Supabase Auth/Storage services; scheduling migration is explicitly quarantined.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appliedFoundation,auditAppliedMigrations} from './check-v2-applied-migration-integrity.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=join(root,'supabase','migrations');
const container='all12-scoped-restore-20261112';
const target='all12_migration_replay_20261113';
const cronMigration='20261110124420_v2_provider_cache_cron_schedule.sql';
const env={...process.env,PGOPTIONS:'-c statement_timeout=60000'};
function exec(bin,args,input){
 const r=spawnSync(bin,args,{input,encoding:'utf8',env,timeout:120000,maxBuffer:1024*1024});
 if(r.error||r.status!==0)throw Error(bin+' failed: '+(r.stderr||r.stdout||r.error?.message).slice(0,1200));
 return r.stdout.trim();
}
export function quarantineCron(sql){
 const begin=sql.indexOf('create or replace function allin_private.v2_provider_cache_prune_expired(');
 const end=sql.indexOf('select cron.schedule(');
 assert(begin>0&&end>begin,'cron migration structure changed');
 const pre=sql.slice(0,begin);
 const after=sql.slice(end).trim();
 assert(/create extension if not exists pg_cron/i.test(pre),'missing expected cron extension declaration');
 assert(/^select cron\.schedule\([\s\S]*\);\s*$/i.test(after),'cron schedule tail changed');
 const safe=sql.slice(begin,end).trim();
 assert(safe.includes('create or replace function public.v2_provider_cache_prune_expired('));
 assert(!/\b(?:cron\.|create\s+extension|pg_net|vault\.)/i.test(safe),'unsafe scheduler/runtime reference');
 return safe+'\n';
}
export function canonicalSql(sql){\n assert(!/(?<!\\r)\\r(?!\\n)/.test(sql),'unsupported isolated CR line ending');\n return sql.replace(/\\r\\n/g,'\\n');\n}\nexport function validateInventory(names,read){
 // Windows Git can check out unchanged .sql with CRLF. Pin the canonical LF\n // bytes already recorded in the authoritative immutable digest ledger.\n const result=auditAppliedMigrations(names,n=>canonicalSql(read(n)));
 assert(result.ok,result.problems.join('; '));
 assert(result.appliedCount===18,'expected 18 canonical migrations');
 const observed=names.filter(n=>/^\d{14}_.*\.sql$/.test(n));
 assert(observed.length===18,'unexpected migration number (refuse newer work until reviewed)');
 return appliedFoundation.map(([name,sha])=>({name,sha}));
}
function sql(db,input,label){
 // Docker exec -i pipes only canonical SQL; one transaction per migration.
 exec('docker',['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1',
   '--single-transaction','-U','postgres','-d',db,'-f','-'],input);
 console.log('PASS '+label);
}
function query(db,statement){
 return exec('docker',['exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
   '-U','postgres','-d',db,'-c',statement]);
}
function main(){
 assert(process.argv.length===2,'Usage: node scripts/all12-replay-applied-v2-migrations-offline.mjs');
 assert(process.env.GITHUB_ACTIONS!=='true'&&process.env.CI!=='true','operator-only');
 const names=readdirSync(dir);const read=n=>readFileSync(join(dir,n),'utf8');
 const files=validateInventory(names,read);
 assert(exec('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container])==='none',
  'container must be network=none');
 assert(query('postgres',"SELECT count(*) FROM pg_database WHERE datname='"+target+"'")==='0',
  'replay target already exists; never reset or overwrite');
 assert(query('postgres',"SELECT (SELECT count(*) FROM pg_roles WHERE rolname='anon')||':'||(SELECT count(*) FROM pg_roles WHERE rolname='authenticated')||':'||(SELECT count(*) FROM pg_roles WHERE rolname='service_role')")==='1:1:1',
  'isolated prerequisite roles missing');
 const authPath='V:\\ALL-12-Recovery\\auth-schema-bootstrap.sql';
 const auth=readFileSync(authPath,'utf8').replace(/^\\(?:un)?restrict[^\r\n]*(?:\r?\n|$)/gm,'');
 assert(!/^\\(?:un)?restrict/m.test(auth),'unsafe pg18 client directive');
 assert(auth.includes('CREATE SCHEMA auth;')||auth.includes('CREATE SCHEMA auth'),'auth schema bootstrap not recognized');
 const journal={evidenceClass:'isolated_canonical_migration_replay_with_cron_quarantined',
  container,target,sourceProject:'xarhuczrtzuiljmtdaeu',
  originalRestoredDatabaseUntouched:'all12_real_source_recovery',
  migrationFiles:files,cronMigrationQuarantined:cronMigration,executed:[],complete:false};
 console.log('START '+JSON.stringify({target,canonicalMigrations:files.length,network:'none',
  cronStrategy:'exclude pg_cron extension, grants and cron.schedule; retain 2 canonical functions'}));
 // The only created DB is distinct from all previously established databases.
 exec('docker',['exec',container,'createdb','-U','postgres',target]);
 try{
   sql(target,auth,'Auth schema bootstrap');
   for(const {name} of files){
     const original=canonicalSql(read(name));
     const executed=name===cronMigration?quarantineCron(original):original;
     assert(!/\b(?:net\.http|pg_net|vault\.|cron\.schedule)\s*\(/i.test(executed),
       'unsafe outbound or scheduler reference '+name);
     sql(target,executed,name+(name===cronMigration?' (quarantined cron)':''));
     journal.executed.push({name,mode:name===cronMigration?'quarantined_function_only':'unaltered'});
   }
   const summary=query(target,"SELECT (SELECT count(*) FROM pg_tables WHERE (schemaname='public' OR schemaname='allin_private') AND tablename LIKE 'v2_%')||'|'||(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','allin_private') AND p.proname LIKE 'v2_%')||'|'||(to_regclass('cron.job') IS NULL)::text");
   const [tables,functions,noCron]=summary.split('|');
   assert(tables==='12'&&functions==='21'&&noCron==='true',
     'unexpected replay counts: '+summary);
   journal.complete=true;journal.result={applicationTables:Number(tables),v2Functions:Number(functions),
     cronInstalled:false,ledgerMaterialized:false,authSignInProven:false,storageServiceProven:false,
     operationalRecoveryAccepted:false};
   console.log('RESULT '+JSON.stringify(journal));
 }catch(e){
   console.error('BLOCKED '+JSON.stringify({...journal,error:String(e.message).slice(0,900)}));
   throw e;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
