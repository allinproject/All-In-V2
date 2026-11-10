import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OFFICIAL_FOUNDATION_ZIP,OFFICIAL_FOUNDATION_URL,
 validateFoundationManifest,verifyFoundationArchive} from './verify-v2-usda-foundation-manifest.mjs';

const sample=(changes={})=>({
 source:'USDA FoodData Central',data_type:'Foundation Foods',
 release_date:'2026-10-29',official_download_url:OFFICIAL_FOUNDATION_URL,
 archive_filename:OFFICIAL_FOUNDATION_ZIP,archive_bytes:1500,
 archive_sha256:'a'.repeat(64),verified_at_utc:'2026-11-10T18:00:00.000Z',
 phase:'source_archive_only_not_imported_not_reviewed',
 archive_members:[{name:'FoundationFoods.json',uncompressed_bytes:3200,compressed_bytes:1490}],
 ...changes,
});

test('pinned release validates only read-only source archive metadata',()=>{
 const valid=validateFoundationManifest(sample());
 assert.equal(valid.archiveBytes,1500);
 assert.equal(valid.jsonFiles,1);
 assert.equal(valid.archiveSha256,'a'.repeat(64));
});

test('reject wrong release, fake checksum, and fabricated completed import',()=>{
 for(const changed of [
  {release_date:'2026-04-01'},
  {archive_filename:'another.zip'},
  {official_download_url:'https://other.example/file.zip'},
  {archive_sha256:'not-a-hash'},
  {archive_bytes:0},
  {verified_at_utc:'2026-11-10T12:00:00-06:00'},
  {phase:'imported'},
 ]){
  assert.throws(()=>validateFoundationManifest(sample(changed)));
 }
 assert.throws(()=>validateFoundationManifest(sample(),'different.zip'));
});

test('reject traversal, duplicate or missing JSON members in source manifest',()=>{
 const member={name:'FoundationFoods.json',uncompressed_bytes:3200,compressed_bytes:1490};
 for(const name of ['../escape.json','a/../escape.json','/root/file.json',
    'C:/fake.json','folder\\file.json','.\\fake.json']){
  assert.throws(()=>validateFoundationManifest(sample({
   archive_members:[{...member,name}],
  })),name);
 }
 assert.throws(()=>validateFoundationManifest(sample({
  archive_members:[member,member],
 })));
 assert.throws(()=>validateFoundationManifest(sample({
  archive_members:[{...member,name:'notes.txt'}],
 })));
 assert.throws(()=>validateFoundationManifest(sample({archive_members:[]})));
});

test('independent archive SHA check detects tampering without importing ingredients',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'v2-usda-manifest-'));
 const archive=join(directory,OFFICIAL_FOUNDATION_ZIP),manifest=join(directory,'manifest.json');
 try{
  const bytes=Buffer.alloc(1500,0x53);
  bytes.set([0x50,0x4b,0x03,0x04],0);
  await writeFile(archive,bytes);
  await writeFile(manifest,JSON.stringify(sample({
   archive_sha256:createHash('sha256').update(bytes).digest('hex'),
  })));
  const accepted=await verifyFoundationArchive(manifest,archive);
  assert.equal(accepted.verified,true);
  assert.equal(accepted.imported,false);
  assert.equal(accepted.nutritionReviewed,false);
  const fakeZip=Buffer.alloc(1500,0x53);
  await writeFile(archive,fakeZip);
  await writeFile(manifest,JSON.stringify(sample({
   archive_sha256:createHash('sha256').update(fakeZip).digest('hex'),
  })));
  await assert.rejects(()=>verifyFoundationArchive(manifest,archive),/ZIP local-file header/);
  await writeFile(archive,bytes);
  await writeFile(manifest,JSON.stringify(sample({
   archive_sha256:createHash('sha256').update(bytes).digest('hex'),
  })));
  bytes[100]=0x54;
  await writeFile(archive,bytes);
  await assert.rejects(()=>verifyFoundationArchive(manifest,archive),/SHA-256/);
  await writeFile(archive,Buffer.from('changed'));
  await assert.rejects(()=>verifyFoundationArchive(manifest,archive),/length/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
