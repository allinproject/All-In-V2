import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative,extname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

// ALL-251: proactive SOURCE guard only. It cannot prove deployment credentials,
// independent Storage/S3 paths, or real lease-vs-deletion races.
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const reviewed=new Map([
 ['supabase/functions/_shared/trainingPrivilegedStorageWriter.mjs',
  ['v2_begin_privileged_storage_write_review',
   'v2_settle_privileged_storage_write_review']],
 ['supabase/functions/_shared/trainingExportSupabaseArchive.mjs',
  ['withOwnerStorageWriteBarrier']],
]);
function enumerate(dir){
 const files=[];
 for(const entry of readdirSync(resolve(root,dir),{withFileTypes:true})){
  const name=dir+'/'+entry.name;
  if(entry.isDirectory())files.push(...enumerate(name));
  else if(entry.isFile()&&/\.(?:mjs|js|ts|tsx)$/.test(entry.name)
    &&!/\.(?:test|spec)\.(?:mjs|js|ts|tsx)$/.test(entry.name)
    &&!entry.name.endsWith('.d.ts'))files.push(name);
 }
 return files;
}
test('all runtime client/server direct Storage upload paths must use the canonical privileged barrier',()=>{
 const unsafe=[];
 let canonical=0,archive=0;
 for(const name of [
  ...enumerate('supabase/functions'),
  ...enumerate('apps/mobile-v2/src'),
  ...enumerate('apps/mobile-v2/app'),
 ]){
  const src=readFileSync(resolve(root,name),'utf8');
  // NEW upload protocols must not silently bypass the canonical writer.
  // A direct privileged S3 key or signed-upload URL is equivalent to a raw
  // service-role Storage upload and bypasses the owner deletion lease.
  const markers=[
   /\.upload\s*\(/g,
   /\.uploadToSignedUrl\s*\(/g,
   /\.createSignedUploadUrl\s*\(/g,
   /\.createUploadSignedUrl\s*\(/g,
   /\/storage\/v1\/(?:object|s3|upload\/resumable)/g,
   /\b(?:PutObjectCommand|UploadPartCommand|CompleteMultipartUploadCommand|CopyObjectCommand|CreateMultipartUploadCommand)\b/g,
   /\b(?:tus\.Upload|new\s+S3Client\s*\(|new\s+tus\.Upload\s*\()/g,
   // Require an actual chained Storage method, not a PostgREST .update().
   /\.storage\s*\.from\s*\([^)]*\)\s*\.(?:update|move|copy)\s*\(/g,
  ];
  const direct=markers.reduce((sum,re)=>sum+[...src.matchAll(re)].length,0);
  if(!direct)continue;
  const requirements=reviewed.get(name);
  if(!requirements || !requirements.every(term=>src.includes(term))){
   unsafe.push(name+' ('+direct+' unreviewed write markers)');
  }else if(name.includes('trainingPrivilegedStorageWriter'))canonical+=direct;
  else archive+=direct;
 }
 assert(canonical>0,'Canonical durable-lease Storage writer is not inventoried');
 assert(archive>0,'Canonical export Storage adapter is not inventoried');
 assert.deepEqual(unsafe,[],'New runtime Storage uploads require all-writer barrier review');
});

test('protected ALL-251 staging Storage secret stays in approved staging workflows',()=>{
 const approved=new Set([
  'v2-all251-temporary-auth-smoke.yml',
  'v2-all251-temporary-hosted-storage.yml',
  'v2-all251-hosted-privileged-writer.yml',
  'v2-all251-hosted-http-route-matrix.yml',
 ]);
 const seen=new Set();
 for(const file of readdirSync(resolve(root,'.github/workflows'))){
  if(!/\.(?:yml|yaml)$/.test(file))continue;
  const src=readFileSync(resolve(root,'.github/workflows',file),'utf8');
  if(!src.includes('secrets.ALL251_TEMP_STAGING_SECRET_KEY'))continue;
  seen.add(file);
  assert(approved.has(file),
   'New privileged Storage credential holder requires ALL-251 review: '+file);
  assert(src.includes('environment: all251-temporary-staging'),
   'Privileged staging credential must remain behind protected environment: '+file);
  assert(src.includes('fbtgknlxjyeqrxemskbl'),
   'Privileged staging credential must be pinned to disposable project: '+file);
 }
 assert.deepEqual([...seen].sort(),[...approved].sort(),
  'Protected privileged Storage credential workflow inventory changed');
 const matrix=readFileSync(resolve(root,
  '.github/workflows/v2-all251-hosted-http-route-matrix.yml'),'utf8');
 assert(matrix.includes('workflow_dispatch:') &&
  matrix.includes("github.ref == 'refs/heads/integration/v2-foundation'") &&
  matrix.includes('environment: all251-temporary-staging') &&
  matrix.includes('needs: offline-script-syntax-only') &&
  matrix.includes('scripts/test-all251-hosted-storage-http-routes.mjs'),
  'New Storage HTTP probe needs protected review and exact staging scope');
 assert(matrix.includes('- .github/workflows/v2-all251-hosted-http-route-matrix.yml') &&
  matrix.includes('- scripts/test-all251-hosted-storage-http-routes.mjs') &&
  !matrix.includes('pull_request:'),
  'New privileged Storage probe push scope must be narrow and no PR secrets');
 const rawProbe=readFileSync(resolve(root,
  '.github/workflows/v2-all251-hosted-privileged-writer.yml'),'utf8');
 assert(rawProbe.includes('workflow_dispatch:'),
  'Raw service-role bypass probe must require an explicit manual run');
 // A protected staging secret in an auto-triggered bypass test would expose
 // full Storage privileges on ordinary repository pushes. No push trigger.
 assert.equal(/^\s*push\s*:/m.test(rawProbe),false,
  'Raw privileged Storage bypass probe must never run automatically');
});


test('provider-level upload freeze cannot be inferred from signed leases or DB metadata alone',()=>{
 const source=(path)=>readFileSync(resolve(root,path),'utf8');
 const readiness=source('docs/architecture/sql/V2-ACCOUNT-DELETION-STORAGE-READINESS-REVIEW.sql');
 const runtime=source('supabase/functions/_shared/trainingDeletionOperationalStorageReadiness.mjs');
 const writer=source('supabase/functions/v2-private-storage-writer/index.ts');
 const audit=source('docs/architecture/ALL-251-PRIVILEGED-STORAGE-CREDENTIAL-ROUTE-AUDIT.md');
 assert(readiness.includes("'completePrivateStorage',false"),
  'Review-only SQL must never certify Storage bytes from database receipts');
 assert(readiness.includes("'uploadBarrierEnforced',false"),
  'Review-only SQL must never certify provider-wide upload freeze');
 assert(runtime.includes('data.uploadBarrierEnforced!==true') &&
        runtime.includes('data.completePrivateStorage!==true'),
  'Operational worker must require both independent provider attestations');
 assert(writer.includes("Deno.env.get('ALLIN_PRIVATE_WRITER_ACCEPTED')!=='true'"),
  'Canonical private writer cannot be enabled by default');
 assert(writer.includes('PROJECT-WIDE')&&writer.includes('NOT independent'),
  'Shared Supabase Edge secrets cannot be represented as scoped writer custody');
 assert(audit.includes('Raw ') && audit.includes('sb_secret_') &&
        audit.includes('direct S3/TUS protocol completion'),
  'Known provider bypass and unsupported delayed routes must remain release blockers');
});


test('mobile runtime must not carry privileged Storage keys, signing keys, or S3 master credentials',()=>{
 const forbidden=[
  /\bSUPABASE_SERVICE_ROLE_KEY\b/,
  /\bsb_secret_[A-Za-z0-9_-]{8,}\b/,
  /\bALLIN_WRITER_ATTESTATION_SECRET_B64\b/,
  /\bALL251_TEMP_STAGING_SECRET_KEY\b/,
  /\bAWS_SECRET_ACCESS_KEY\b/,
  /\bS3_SECRET_ACCESS_KEY\b/,
  /\bS3_ACCESS_KEY_ID\b/,
 ];
 const exposed=[];
 for(const dir of ['apps/mobile-v2/src','apps/mobile-v2/app']){
  for(const file of enumerate(dir)){
   // The packaged app must not contain even a convenient reference to a
   // privileged credential; keep all attestation and account deletion
   // execution server-side.
   const src=readFileSync(resolve(root,file),'utf8');
   for(const pattern of forbidden){
    if(pattern.test(src))exposed.push(file+' includes '+pattern.source);
   }
  }
 }
 assert.deepEqual(exposed,[],'Mobile runtime would expose privileged upload authority');
});
