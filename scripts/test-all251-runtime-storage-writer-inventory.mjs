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
  'v2-all251-hosted-owner-rest-isolation.yml',
  'v2-all251-hosted-r2-byte-proof.yml',
  'v2-all251-hosted-worker-session-gate.yml',
  'v2-all246-temporary-staging-auth.yml',
  'all222-storage-http-acceptance.yml',
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
 // ALL-246 Auth fixture needs service-role only for disposable identity setup
 // and cleanup, never for client Routine access. Require human-invoked protected
 // staging CI, no push/PR/schedule and no independent writer signer.
 const routineAuthWorkflow=readFileSync(resolve(root,
  '.github/workflows/v2-all246-temporary-staging-auth.yml'),'utf8');
 assert(routineAuthWorkflow.includes('workflow_dispatch:'),
  'ALL-246 privileged Auth staging probe must be explicitly invoked');
 assert.equal(/^\s*(?:push|pull_request|schedule|workflow_run)\s*:/m.test(routineAuthWorkflow),false,
  'ALL-246 privileged Auth probe cannot auto-run on repository events');
 assert(routineAuthWorkflow.includes('environment: all251-temporary-staging'),
  'ALL-246 Auth credentials must remain in approved staging environment');
 assert(routineAuthWorkflow.includes('fbtgknlxjyeqrxemskbl'),
  'ALL-246 Auth acceptance must target only disposable staging');
 assert.equal(routineAuthWorkflow.includes('ALLIN_WRITER_ATTESTATION_SECRET_B64'),false,
  'ALL-246 Auth probe must not hold writer signing key');

 // ALL-222 direct Storage-denial HTTP probe carries a project privileged
 // secret for synthetic Auth creation and cleanup. It must never auto-run,
 // bypass the environment reviewer, or obtain the writer signer.
 const all222Workflow=readFileSync(resolve(root,
  '.github/workflows/all222-storage-http-acceptance.yml'),'utf8');
 assert(all222Workflow.includes('workflow_dispatch:'),
  'ALL-222 Storage HTTP acceptance must require manual dispatch');
 assert.equal(/^\s*(?:push|pull_request|schedule|workflow_run)\s*:/m.test(all222Workflow),false,
  'ALL-222 privileged Storage probe must not run automatically');
 assert(all222Workflow.includes("if: github.ref == 'refs/heads/integration/v2-foundation'"),
  'ALL-222 must run only on the integration foundation branch');
 assert(all222Workflow.includes('environment: all251-temporary-staging'),
  'ALL-222 secret must remain behind protected staging');
 assert(all222Workflow.includes('fbtgknlxjyeqrxemskbl'),
  'ALL-222 must target the disposable staging project');
 assert.equal(all222Workflow.includes('ALLIN_WRITER_ATTESTATION_SECRET_B64'),false,
  'ALL-222 HTTP probe must never receive the writer signer');

 // R2 byte proof uses a privileged synthetic Auth setup key. Only manual,
 // integration-branch-scoped execution is allowed; no push marker or signer.
 const r2Workflow=readFileSync(resolve(root,
  '.github/workflows/v2-all251-hosted-r2-byte-proof.yml'),'utf8');
 assert(r2Workflow.includes('workflow_dispatch:'),
  'R2 byte proof requires explicit manual dispatch');
 assert.equal(/^\\s*(?:push|pull_request|schedule|workflow_run)\\s*:/m.test(r2Workflow),false,
  'Privileged R2 byte proof must not auto-run');
 assert(r2Workflow.includes("if: github.ref == 'refs/heads/integration/v2-foundation'"),
  'R2 byte proof must stay pinned to integration branch');
 assert(r2Workflow.includes('environment: all251-temporary-staging'),
  'R2 byte proof must use protected staging');
 assert(r2Workflow.includes('fbtgknlxjyeqrxemskbl'),
  'R2 byte proof must target disposable staging');
 assert.equal(r2Workflow.includes('ALLIN_WRITER_ATTESTATION_SECRET_B64'),false,
  'R2 proof must never receive writer signer');

 // Hosted Worker session gate is a privileged Auth fixture, not Storage
 // upload approval. Keep its environment, ref, and no-auto-run restrictions.
 const sessionWorkflow=readFileSync(resolve(root,
  '.github/workflows/v2-all251-hosted-worker-session-gate.yml'),'utf8');
 assert(sessionWorkflow.includes('workflow_dispatch:'),
  'Worker session gate requires explicit manual dispatch');
 assert.equal(/^\\s*(?:push|pull_request|schedule|workflow_run)\\s*:/m.test(sessionWorkflow),false,
  'Privileged Worker session gate must not auto-run');
 assert(sessionWorkflow.includes("if: github.ref == 'refs/heads/integration/v2-foundation'"),
  'Worker session gate must stay pinned to integration');
 assert(sessionWorkflow.includes('environment: all251-temporary-staging'),
  'Worker session gate must use protected staging');
 assert(sessionWorkflow.includes('fbtgknlxjyeqrxemskbl'),
  'Worker session gate must target disposable staging');
 assert.equal(sessionWorkflow.includes('ALLIN_WRITER_ATTESTATION_SECRET_B64'),false,
  'Worker session gate must never receive signer');

 // The separate writer attestation signing key must never be provided to
 // GitHub Actions: a protected environment is not exclusive writer custody.
 for(const file of readdirSync(resolve(root,'.github/workflows'))){
  if(!/\.(?:yml|yaml)$/.test(file))continue;
  const src=readFileSync(resolve(root,'.github/workflows',file),'utf8');
  assert.equal(/(?:secrets|vars)\.ALLIN_WRITER_ATTESTATION_SECRET_B64/.test(src),false,
   'ALL-251 signing key must never be exported to a GitHub workflow: '+file);
 }
 // Keep the positive-control REST harness manual-only and fail-closed:
 // it must never turn an unavailable trusted writer into a fake PASS.
 const ownerWorkflow=readFileSync(resolve(root,
  '.github/workflows/v2-all251-hosted-owner-rest-isolation.yml'),'utf8');
 const ownerHarness=readFileSync(resolve(root,
  'scripts/test-all251-hosted-owner-rest-isolation.mjs'),'utf8');
 assert(ownerWorkflow.includes('workflow_dispatch:'),
  'Owner REST acceptance must be manually approved');
 assert.equal(/^\\s*push\\s*:/m.test(ownerWorkflow),false,
  'Owner REST acceptance must not execute on a repository push');
 assert(ownerWorkflow.includes('environment: all251-temporary-staging'),
  'Owner REST credential must remain inside protected staging');
 assert(ownerHarness.includes('/functions/v1/v2-private-storage-writer'),
  'Owner positive control must use the canonical trusted writer');
 assert(ownerHarness.includes('assert.equal(written.status,201'),
  'Owner positive control must require a successful real upload');
 assert(ownerHarness.includes('assert(denied(bRead)'),
  'B-to-A private Storage REST read denial must be verified');
 assert.equal(ownerWorkflow.includes('ALLIN_WRITER_ATTESTATION_SECRET_B64'),false,
  'Owner REST CI must never receive the writer signer');

 const rawProbe=readFileSync(resolve(root,
  '.github/workflows/v2-all251-hosted-privileged-writer.yml'),'utf8');
 assert(rawProbe.includes('workflow_dispatch:'),
  'Raw service-role bypass probe must require an explicit manual run');
 // A protected staging secret in an auto-triggered bypass test would expose
 // full Storage privileges on ordinary repository pushes. No push trigger.
 assert.equal(/^\s*push\s*:/m.test(rawProbe),false,
  'Raw privileged Storage bypass probe must never run automatically');
});
