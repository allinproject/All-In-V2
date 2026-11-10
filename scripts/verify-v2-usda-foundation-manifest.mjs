/**
 * ALL-228: read-only, independent verification of the locally created USDA
 * Foundation archive manifest. Does NOT parse ZIP structure, trust nutrient
 * values, fetch sources or write/import shared catalog records.
 *
 * node scripts/verify-v2-usda-foundation-manifest.mjs <manifest.json> <archive.zip>
 * ZIP structure was checked separately by the PowerShell acquisition helper.
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';

export const OFFICIAL_FOUNDATION_ZIP='FoodData_Central_foundation_food_json_2026-10-29.zip';
export const OFFICIAL_FOUNDATION_URL=
  'https://fdc.nal.usda.gov/fdc-datasets/'+OFFICIAL_FOUNDATION_ZIP;
const SHA256=/^[a-f\d]{64}$/i;
const SAFE_MEMBER=/^[^\\\u0000-\u001f]+$/;

export function validateFoundationManifest(raw, archiveFilename=OFFICIAL_FOUNDATION_ZIP){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid source manifest object');
  if(raw.source!=='USDA FoodData Central'||raw.data_type!=='Foundation Foods'||
     raw.release_date!=='2026-10-29'||raw.official_download_url!==OFFICIAL_FOUNDATION_URL||
     raw.archive_filename!==OFFICIAL_FOUNDATION_ZIP||
     archiveFilename!==OFFICIAL_FOUNDATION_ZIP||
     raw.phase!=='source_archive_only_not_imported_not_reviewed'){
    throw new Error('Manifest source, release or candidate-only status differs from pinned USDA snapshot');
  }
  if(!Number.isSafeInteger(raw.archive_bytes)||raw.archive_bytes<1000||
     typeof raw.archive_sha256!=='string'||!SHA256.test(raw.archive_sha256)){
    throw new Error('Invalid archive byte length or SHA-256 in manifest');
  }
  if(typeof raw.verified_at_utc!=='string'||!/^\d{4}-\d\d-\d\dT/.test(raw.verified_at_utc)||
    !/(?:Z|\+00:00)$/i.test(raw.verified_at_utc)||
    !Number.isFinite(Date.parse(raw.verified_at_utc))){
    throw new Error('Manifest verification timestamp must be UTC and parseable');
  }
  if(!Array.isArray(raw.archive_members)||!raw.archive_members.length||
    raw.archive_members.length>2000)throw new Error('Archive member inventory is missing or excessive');
  const names=new Set();
  let jsonFiles=0;
  for(const member of raw.archive_members){
    if(!member||typeof member.name!=='string'||!member.name||
      !SAFE_MEMBER.test(member.name)||member.name.startsWith('/')||
      member.name.startsWith('\\')||member.name.includes('\\')||
      /^[a-z]:/i.test(member.name)||
      member.name.split('/').some(part=>part==='..'||part==='.')||
      !Number.isSafeInteger(member.uncompressed_bytes)||member.uncompressed_bytes<0||
      !Number.isSafeInteger(member.compressed_bytes)||member.compressed_bytes<0||
      names.has(member.name))throw new Error('Unsafe, duplicate or malformed ZIP member metadata');
    names.add(member.name);
    if(member.name.toLowerCase().endsWith('.json')&&member.uncompressed_bytes>0)jsonFiles++;
  }
  if(!jsonFiles)throw new Error('USDA Foundation snapshot must contain at least one nonempty JSON member');
  return {filename:OFFICIAL_FOUNDATION_ZIP,release:'2026-10-29',
    archiveBytes:raw.archive_bytes,archiveSha256:raw.archive_sha256.toLowerCase(),
    members:names.size,jsonFiles};
}

export async function verifyFoundationArchive(manifestPath,archivePath){
  if(typeof manifestPath!=='string'||typeof archivePath!=='string'||!manifestPath||!archivePath)
    throw new Error('Both manifest and archive paths are required');
  let raw;
  try { raw=JSON.parse(await readFile(manifestPath,'utf8')); }
  catch { throw new Error('Unable to read valid JSON source manifest'); }
  const expected=validateFoundationManifest(raw,basename(archivePath));
  const details=await stat(archivePath);
  if(!details.isFile()||details.size!==expected.archiveBytes)
    throw new Error('Archive length differs from recorded source manifest');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(archivePath))hash.update(chunk);
  if(hash.digest('hex')!==expected.archiveSha256)
    throw new Error('Archive SHA-256 differs from recorded source manifest');
  return {...expected,verified:true,nutritionReviewed:false,imported:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [, ,manifestPath,archivePath]=process.argv;
  try{
    const result=await verifyFoundationArchive(manifestPath,archivePath);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
    process.stderr.write('USDA verification failed: '+error.message+'\n');
    process.exitCode=1;
  }
}
