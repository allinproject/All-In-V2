// ALL-12: inspect a real, offline PostgreSQL custom-format logical dump
// BEFORE import. Read-only: never calls pg_restore -d, psql or Supabase APIs.
// Does not prove the backup source, per-row data, restored Auth or Storage bytes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const qualified=/^(?:auth|public|allin_private|storage|supabase_migrations)\.[a-z_][a-z0-9_]*$/;
const hash=/^[a-f0-9]{64}$/i;
export function parsePgRestoreToc(output) {
 const entries=[];
 for(const line of output.split(/\r?\n/)) {
  const match=line.match(/^\s*\d+;\s+\d+\s+\d+\s+(.+)$/);
  if(!match)continue;
  const detail=match[1];
  const table=detail.match(/^TABLE DATA\s+(\S+)\s+(\S+)\s+/);
  const seq=detail.match(/^SEQUENCE SET\s+(\S+)\s+(\S+)\s+/);
  if(table)entries.push({kind:'table',name:table[1]+'.'+table[2]});
  else if(seq)entries.push({kind:'sequence',name:seq[1]+'.'+seq[2]});
  else entries.push({kind:'unsafe_or_unsupported',description:detail.split(/\s+/).slice(0,3).join(' ')});
 }
 return entries;
}
export function assessLogicalArchiveToc({toc,inventory,digest}) {
 const reasons=[];
 if(!inventory||typeof inventory!=='object'||Array.isArray(inventory))return {accepted:false,reasons:['missing_inventory']};
 if(typeof inventory.sourceProjectRef!=='string'||!inventory.sourceProjectRef.trim())
  reasons.push('missing_source_ref');
 if(typeof inventory.backupCutoffUtc!=='string'||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(inventory.backupCutoffUtc)||
    !Number.isFinite(Date.parse(inventory.backupCutoffUtc)))reasons.push('invalid_source_cutoff');
 if(!hash.test(inventory.archiveSha256??'')||digest?.toLowerCase()!==inventory.archiveSha256?.toLowerCase())
  reasons.push('archive_digest_mismatch');
 const expectedTables=inventory.tables,expectedSequences=inventory.sequences??[];
 if(!Array.isArray(expectedTables)||expectedTables.length===0||expectedTables.some(x=>typeof x!=='string'||!qualified.test(x))||
    new Set(expectedTables).size!==expectedTables.length)reasons.push('invalid_table_allowlist');
 if(!Array.isArray(expectedSequences)||expectedSequences.some(x=>typeof x!=='string'||!qualified.test(x))||
    new Set(expectedSequences).size!==expectedSequences.length)reasons.push('invalid_sequence_allowlist');
 const items=parsePgRestoreToc(typeof toc==='string'?toc:'');
 if(items.length===0)reasons.push('empty_archive_toc');
 if(items.some(x=>x.kind==='unsafe_or_unsupported'))reasons.push('unsafe_or_unsupported_toc_entries');
 const actualTables=items.filter(x=>x.kind==='table').map(x=>x.name);
 const actualSequences=items.filter(x=>x.kind==='sequence').map(x=>x.name);
 if(new Set(actualTables).size!==actualTables.length||new Set(actualSequences).size!==actualSequences.length)
  reasons.push('duplicate_toc_entries');
 if(Array.isArray(expectedTables) && (
     actualTables.length!==expectedTables.length ||
     actualTables.some(t=>!expectedTables.includes(t)) ||
     expectedTables.some(t=>!actualTables.includes(t))))reasons.push('table_inventory_mismatch');
 if(Array.isArray(expectedSequences)&&(
     actualSequences.length!==expectedSequences.length||
     actualSequences.some(t=>!expectedSequences.includes(t))||
     expectedSequences.some(t=>!actualSequences.includes(t))))reasons.push('sequence_inventory_mismatch');
 return {accepted:reasons.length===0,reasons:[...new Set(reasons)],tableCount:actualTables.length,sequenceCount:actualSequences.length};
}
async function sha256(path) {
 const digest=createHash('sha256');
 for await (const chunk of createReadStream(path))digest.update(chunk);
 return digest.digest('hex');
}
async function main() {
 const args=process.argv.slice(2);
 assert(args.length===4&&args[0]==='--archive'&&args[2]==='--inventory',
   'usage: node scripts/all12-verify-logical-archive.mjs --archive <pg_dump.custom> --inventory <approved-source-manifest.json>');
 const archive=resolve(args[1]),inventoryFile=resolve(args[3]);
 assert(archive!==inventoryFile,'archive and manifest must be separate');
 const inventory=JSON.parse(readFileSync(inventoryFile,'utf8'));
 const digest=await sha256(archive);
 // -l reads only; no database connection or restore permitted.
 const toc=execFileSync('pg_restore',['-l',archive],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 const result=assessLogicalArchiveToc({toc,inventory,digest});
 if(!result.accepted) {
  console.error('FAIL ALL-12 pre-import archive inspection: '+result.reasons.join(', '));
  process.exitCode=1;
 }else{
  console.log('PASS ALL-12 pre-import archive TOC and SHA-256 ('+result.tableCount+' tables, '+result.sequenceCount+' sequences).');
  console.log('NOT proof of source cutoff, row content, isolation, safe import, Auth/Storage recovery, RPO/RTO or release acceptance.');
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(err=>{
 console.error('FAIL ALL-12 archive inspection: '+(err.code||err.name||'error'));process.exitCode=1;
});
