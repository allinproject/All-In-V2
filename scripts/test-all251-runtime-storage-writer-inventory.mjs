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
