// ALL-12 operator-only: capture a source-consistent PostgreSQL data-only
// custom-format archive. No production mutation or restore. Never run in CI.
// Credentials are inherited via PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD/
// PGSSLMODE, not arguments, log output, GitHub secrets or checked-in files.
// The supplied approved table list must be reviewed INDEPENDENTLY from the
// archive TOC. This capture is not final operational restore acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,readFileSync,mkdirSync,openSync,closeSync,writeFileSync,unlinkSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const allowed=/^(?:public|allin_private|auth)\.[a-z_][a-z0-9_]*$/;
const blocked=/\b(?:vault|cron|net|secret|password|token|credential)\b/i;

export function validateCaptureInputs({env,approved}) {
 const errors=[];
 if(env.CI==='true'||env.CI==='1'||env.GITHUB_ACTIONS==='true')errors.push('local_operator_only');
 if(env.ALL12_CAPTURE_APPROVED!=='YES')errors.push('explicit_capture_authorization_required');
 if(env.ALL12_SOURCE_PROJECT_REF!=='xarhuczrtzuiljmtdaeu')errors.push('v2_source_ref_required');
 if(env.ALL12_SECURE_BACKUP_DIRECTORY_CONFIRMED!=='YES')errors.push('secure_offline_storage_confirmation_required');
 if(!env.ALL12_BACKUP_DIRECTORY)errors.push('missing_backup_directory');
 for(const key of ['PGHOST','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE'])
  if(typeof env[key]!=='string'||!env[key])errors.push('missing_'+key.toLowerCase());
 if(env.PGSSLMODE!=='verify-full')errors.push('tls_verify_full_required');
 if(env.PGDATABASE && env.PGDATABASE!=='postgres')errors.push('unexpected_source_database');
 if(!approved||typeof approved!=='object'||Array.isArray(approved))errors.push('missing_approved_inventory');
 if(approved && approved.sourceProjectRef!==env.ALL12_SOURCE_PROJECT_REF)errors.push('inventory_source_mismatch');
 const tables=approved?.tables;
 if(!Array.isArray(tables)||tables.length===0||new Set(tables).size!==tables?.length||
    tables.some(t=>typeof t!=='string'||!allowed.test(t)||blocked.test(t)))
  errors.push('invalid_or_unsafe_table_inventory');
 if(approved?.approvedForLogicalBackup!==true)errors.push('table_inventory_not_approved');
 return {valid:errors.length===0,errors};
}

async function sha256(path) {
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(path))hash.update(chunk);
 return hash.digest('hex');
}

async function main() {
 const args=process.argv.slice(2);
 assert(args.length===2&&args[0]==='--inventory',
  'usage: node scripts/all12-capture-approved-logical-backup.mjs --inventory <reviewed-local.json>');
 const inventory=JSON.parse(readFileSync(resolve(args[1]),'utf8'));
 const check=validateCaptureInputs({env:process.env,approved:inventory});
 if(!check.valid)throw Error('ALL-12 capture refused: '+check.errors.join(', '));
 const dir=resolve(process.env.ALL12_BACKUP_DIRECTORY);
 assert(!dir.includes('/.git/')&&!dir.endsWith('/.git')&&!dir.includes('\\.git\\'),
  'Never write private recovery archives into Git');
 // Directory and files are private, but the operator must also supply verified
 // encrypted-at-rest storage. Permissions alone are NOT encryption.
 mkdirSync(dir,{recursive:true,mode:0o700});
 const prefix='all12-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
 const archive=join(dir,prefix+'.custom'),manifest=join(dir,prefix+'.capture.json');
 assert(!existsSync(archive)&&!existsSync(manifest),'Refusing overwrite');
 const started=new Date().toISOString();
 const argv=['--format=custom','--data-only','--no-owner','--no-acl','--file='+archive,
  ...inventory.tables.flatMap(t=>['--table='+t])];
 let fd;
 try {
  // Reserve the destination as owner-only; pg_dump creates/truncates it.
  fd=openSync(archive,'wx',0o600);closeSync(fd);fd=undefined;
  const dump=spawnSync('pg_dump',argv,{env:process.env,encoding:'utf8',
   stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:1024*1024});
  if(dump.error||dump.status!==0)throw Error('pg_dump_failed; inspect tool availability, table privileges and trusted TLS settings locally');
  if(statSync(archive).size<=0)throw Error('empty_backup_artifact');
  const digest=await sha256(archive);
  const completed=new Date().toISOString();
  const result={
   recoveryMethod:'independent_logical',
   sourceProjectRef:inventory.sourceProjectRef,
   archiveSha256:digest,
   backupStartedUtc:started,
   backupCompletedUtc:completed,
   // Real snapshot acquisition time is inside the dump window. Never
   // manufacture an exact cutoff time or an RPO from local clock alone.
   backupCutoffWindowUtc:{notBefore:started,notAfter:completed},
   tables:inventory.tables,
   sequenceInventoryStatus:'unreviewed',
   nextStep:'independently verify pg_restore TOC and archived sequence list; then an isolated safe restore with owner/Auth/Storage/config verification',
   operationalRecoveryAccepted:false
  };
  writeFileSync(manifest,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('PASS ALL-12 local approved capture: archive saved to operator-controlled directory');
  console.log('SHA-256: '+digest);
  console.log('Source snapshot cutoff is bounded by start/end, not independently attested.');
  console.log('NO restore, no private data upload, no operational acceptance.');
 } catch(error) {
  try {unlinkSync(archive)}catch{}
  try {unlinkSync(manifest)}catch{}
  throw error;
 } finally {if(fd!==undefined)try{closeSync(fd)}catch{}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{console.error(error.message);process.exitCode=1});
}
