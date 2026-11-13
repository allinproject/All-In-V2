// ALL-12: operator-only read-only evidence from an existing offline V2 restore.
// No source connection, database mutation, new container, or release acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parsePgRestoreToc} from './all12-verify-logical-archive.mjs';
export function assessOfflineTarget({capture,toc,digest,networkMode,database}){
 const blockers=[];
 if(capture?.sourceProjectRef!=='xarhuczrtzuiljmtdaeu')blockers.push('source_ref_mismatch');
 if(!/^[a-f0-9]{64}$/i.test(capture?.archiveSha256??'')||
    capture.archiveSha256?.toLowerCase()!==digest?.toLowerCase())blockers.push('digest_mismatch');
 if(capture?.catalogPreflightAndPostflightMatch!==true)blockers.push('unverified_source_inventory');
 if(networkMode!=='none')blockers.push('target_has_network');
 if(!/^all12_[a-z0-9_]+$/.test(database??''))blockers.push('unsafe_restore_database');
 const items=parsePgRestoreToc(toc??'');
 const tables=items.filter(x=>x.kind==='table').map(x=>x.name);
 const seq=items.filter(x=>x.kind==='sequence').map(x=>x.name);
 if(items.some(x=>x.kind==='unsafe_or_unsupported'))blockers.push('unsupported_archive_entry');
 if(tables.length!==16||new Set(tables).size!==16||
    !Array.isArray(capture?.tables)||capture.tables.length!==16||
    tables.some(x=>!capture.tables.includes(x))||capture.tables.some(x=>!tables.includes(x)))
   blockers.push('archive_tables_do_not_match_capture');
 if(seq.length!==1||seq[0]!=='auth.refresh_tokens_id_seq')blockers.push('sequence_not_reconciled');
 return {safeToInspect:!blockers.length,blockers,tables};
}
function command(bin,args){
 const r=spawnSync(bin,args,{encoding:'utf8',timeout:45000,maxBuffer:1024*1024,
   stdio:['ignore','pipe','pipe']});
 if(r.error||r.status!==0)throw Error('read-only command failed: '+bin);
 return r.stdout.trim();
}
async function sha(path){
 const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);
 return h.digest('hex');
}
async function main(){
 assert(!['1','true'].includes(process.env.CI)&&process.env.GITHUB_ACTIONS!=='true',
   'operator only: never use hosted CI for the real source archive');
 const args=process.argv.slice(2);
 assert(args.length===6&&args[0]==='--archive'&&args[2]==='--capture'&&args[4]==='--database',
   'usage: node scripts/all12-verify-real-source-offline-target.mjs --archive <path> --capture <path> --database <existing-all12-database>');
 const archive=resolve(args[1]),capture=JSON.parse(readFileSync(resolve(args[3]),'utf8'));
 const database=args[5],container='all12-scoped-restore-20261112';
 const digest=await sha(archive),toc=command('pg_restore',['--list',archive]);
 const networkMode=command('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container]);
 const v=assessOfflineTarget({capture,toc,digest,networkMode,database});
 if(!v.safeToInspect)throw Error('refused: '+v.blockers.join(','));
 const psql=sql=>command('docker',['exec','-e','PGOPTIONS=-c default_transaction_read_only=on',
   container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',sql]);
 const tableCounts=[];
 for(const table of [...v.tables].sort()){
  const [schema,name]=table.split('.');
  assert(/^[a-z_][a-z0-9_]*$/.test(schema)&&/^[a-z_][a-z0-9_]*$/.test(name));
  const count=psql('SELECT count(*) FROM "'+schema+'"."'+name+'";');
  assert(/^\d+$/.test(count),'invalid table count');
  tableCounts.push({table,rows:Number(count)});
 }
 const sequence=psql("SELECT last_value::text||','||is_called::text FROM auth.refresh_tokens_id_seq;");
 const rls=psql("SELECT count(*)::text||','||(count(*) FILTER (WHERE c.relrowsecurity))::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','allin_private') AND c.relkind IN ('r','p') AND c.relname LIKE 'v2_%';");
 console.log(JSON.stringify({
   evidenceClass:'operator_offline_observation_only',
   sourceRef:capture.sourceProjectRef,sha256:digest,checkedAtUtc:new Date().toISOString(),
   cutoffWindow:capture.backupCutoffWindowUtc,container,networkMode,database,
   tableCounts,authRefreshTokenSequence:sequence,applicationTableAndRlsCounts:rls,
   sourceCutoffAttested:false,sourceTargetDigestsMatched:false,
   authProviderConfigRestored:false,storageConfigRestored:false,
   rpoSeconds:null,rtoSeconds:null,operationalRecoveryAccepted:false
 },null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('FAIL ALL-12: '+e.message);process.exitCode=1});
