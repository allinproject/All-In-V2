import test from 'node:test';
import assert from 'node:assert/strict';
import {previewVerifiedLargeAccountExport,type V2LargeExportFile} from './accountExportLargeFile.ts';
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
function fixture() {
  let exists=false;
  const events:string[]=[];
  const file:V2LargeExportFile={
    uri:'file:///app/cache/allin365-account-export.ndjson',
    get exists(){return exists;},
    async remove(){events.push('purge');exists=false;},
    async preview(){events.push('preview');},
  };
  const download=async()=>{events.push('download');exists=true;};
  const verified=async()=>{events.push('verify');return {
    verified:true as const,complete:true as const,ownerId:owner,
    sha256:'a'.repeat(64),bytes:6_000_000,
  };};
  return {file,events,download,verified,reset:()=>{exists=true;}};
}
test('preview occurs only after complete download, digest and current owner checks',async()=>{
 const f=fixture();let checks=0;
 const result=await previewVerifiedLargeAccountExport({
  ownerId:owner,file:f.file,downloadToTemporaryFile:f.download,
  verifyFile:f.verified,stillAuthorized:async()=>{checks++;return true;},
 });
 assert.equal(result.bytes,6_000_000);
 assert.equal(checks,2);
 assert.deepEqual(f.events,['download','verify','preview']);
});
test('download interrupted: delete partial file, never preview',async()=>{
 const f=fixture();
 await assert.rejects(previewVerifiedLargeAccountExport({
  ownerId:owner,file:f.file,
  downloadToTemporaryFile:async()=>{await f.download();throw Error('network interruption');},
  verifyFile:f.verified,stillAuthorized:async()=>true,
 }),/network interruption/);
 assert.deepEqual(f.events,['download','purge']);
 assert.equal(f.file.exists,false);
});
test('missing checksum and false completion fail closed',async()=>{
 for(const receipt of [{verified:true,complete:false,ownerId:owner,sha256:'a'.repeat(64),bytes:42},
  {verified:true,complete:true,ownerId:other,sha256:'a'.repeat(64),bytes:42},
  {verified:true,complete:true,ownerId:owner,sha256:'wrong',bytes:42}]){
  const f=fixture();
  await assert.rejects(previewVerifiedLargeAccountExport({
   ownerId:owner,file:f.file,downloadToTemporaryFile:f.download,
   verifyFile:async()=>receipt as never,stillAuthorized:async()=>true,
  }),/not verified/);
  assert.equal(f.file.exists,false);
  assert.equal(f.events.includes('preview'),false);
 }
});
test('account changed after completed file verification: delete before preview',async()=>{
 const f=fixture();let check=0;
 await assert.rejects(previewVerifiedLargeAccountExport({
  ownerId:owner,file:f.file,downloadToTemporaryFile:f.download,
  verifyFile:f.verified,stillAuthorized:async()=>++check===1,
 }),/account changed/);
 assert.deepEqual(f.events,['download','verify','purge']);
});
test('native preview error deletes sensitive temporary export',async()=>{
 const f=fixture();
 await assert.rejects(previewVerifiedLargeAccountExport({
  ownerId:owner,file:{...f.file,get exists(){return f.file.exists;},preview:async()=>{throw Error('viewer failed');}},
  downloadToTemporaryFile:f.download,verifyFile:f.verified,stillAuthorized:async()=>true,
 }),/viewer failed/);
 assert.equal(f.file.exists,false);
});
test('unknown cleanup does not claim success',async()=>{
 const f=fixture();
 await assert.rejects(previewVerifiedLargeAccountExport({
  ownerId:owner,file:{...f.file,get exists(){return f.file.exists;},remove:async()=>{throw Error('cache locked');}},
  downloadToTemporaryFile:async()=>{await f.download();throw Error('download failed');},
  verifyFile:f.verified,stillAuthorized:async()=>true,
 }),/cleanup requires manual attention/);
});

test('owner changes while native preview is resolving: revoke result and purge plaintext cache',async()=>{
 const f=fixture();let checks=0;
 await assert.rejects(previewVerifiedLargeAccountExport({
  ownerId:owner,file:f.file,downloadToTemporaryFile:f.download,
  verifyFile:f.verified,
  stillAuthorized:async()=>++checks<3,
 }),/account changed during preview/);
 assert.equal(checks,3);
 assert.deepEqual(f.events,['download','verify','preview','purge']);
 assert.equal(f.file.exists,false);
});

test('native preview completion leaves cache for viewer until screen-level cleanup',async()=>{
 const f=fixture();let checks=0;
 await previewVerifiedLargeAccountExport({
  ownerId:owner,file:f.file,downloadToTemporaryFile:f.download,
  verifyFile:f.verified,stillAuthorized:async()=>{checks++;return true;},
 });
 assert.equal(checks,3);
 assert.equal(f.file.exists,true,
  'Screen must delete cache when native viewer is finished or screen unmounts');
});
