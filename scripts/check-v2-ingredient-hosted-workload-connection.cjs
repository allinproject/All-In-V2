'use strict';
// ALL-228 hosted TEMP-only credentialed acceptance. No credentials in code,
// CLI arguments or logs. Not a migration or a publisher grant.
const {spawnSync}=require('node:child_process');
const {statSync,existsSync}=require('node:fs');
const {HOSTED_READINESS_SQL,checkHostedIngestReadiness}=
  require('./run-v2-ingredient-auto-qualification.cjs');
const PROJECT='fbtgknlxjyeqrxemskbl';
const LOGIN='allin_ing_workload_temp_all228';
const ROLE='allin_v2_ingredient_reviewer';
function assertConfig(env) {
  if(env.ALL228_ALLOW_HOSTED_INGEST_SMOKE!=='1'||
     env.ALL228_TEMP_STAGING_PROJECT_REF!==PROJECT)
    throw Error('Temporary staging opt-in and exact project ref required');
  if(!/^[a-z0-9-]+\\.pooler\\.supabase\\.com$/.test(env.PGHOST||'')||
     env.PGPORT!=='5432'||env.PGDATABASE!=='postgres'||
     env.PGUSER!==LOGIN+'.'+PROJECT)
    throw Error('Refusing host/role outside designated temporary project');
  if(env.PGSSLMODE!=='verify-full'||!env.PGSSLROOTCERT||
     !existsSync(env.PGSSLROOTCERT))
    throw Error('Verified TLS root certificate required');
  if(!env.PGPASSFILE||!existsSync(env.PGPASSFILE)||
     (statSync(env.PGPASSFILE).mode&0o077)!==0)
    throw Error('Private .pgpass credential file (0600) required');
  for(const key of ['PGPASSWORD','DATABASE_URL','PGURI','PGHOSTADDR','PGSERVICE',
    'PGSERVICEFILE','PGOPTIONS','PGCONNECT_TIMEOUT','PGTARGETSESSIONATTRS'])
    if(env[key])throw Error('Unapproved connection override: '+key);
  return {login:LOGIN};
}
function query() {
  const safe=HOSTED_READINESS_SQL.trim().replace(/;\s*$/,'');
  return `BEGIN READ ONLY;
SET LOCAL ROLE ${ROLE};
SELECT row_to_json(all228_proof)::text FROM (${safe}) AS all228_proof;
ROLLBACK;`;
}
async function main(env=process.env,exec=spawnSync) {
  assertConfig(env);
  const p=exec('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',query()],
    {encoding:'utf8',env,timeout:20000,maxBuffer:10000});
  if(p.error||p.status!==0)throw Error('Independent staging database login or read-only readiness failed');
  const line=(p.stdout||'').split('\n').map(x=>x.trim()).find(x=>x.startsWith('{'));
  if(!line)throw Error('Missing authenticated database security proof');
  const proof=JSON.parse(line);
  const result=await checkHostedIngestReadiness(
    {query:async()=>({rows:[proof]})},{requirePublisher:false});
  process.stdout.write(JSON.stringify({status:'independent_login_accepted',
    login:result.login,publisherGranted:false,hostedWritesTested:false})+'\n');
}
if(require.main===module){
  main().catch(e=>{process.stderr.write('ALL-228 hosted acceptance blocked: '+e.message+'\n');process.exitCode=1;});
}
module.exports={assertConfig,query,main,PROJECT,LOGIN};
