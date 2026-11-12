import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLogicalArchiveToc,parsePgRestoreToc} from './all12-verify-logical-archive.mjs';

const digest='a'.repeat(64);
const toc=[
 '; Archive created by pg_dump',
 '18; 0 0 TABLE DATA auth users postgres',
 '19; 0 0 TABLE DATA public v2_profiles postgres',
 '20; 0 0 TABLE DATA allin_private v2_provider_cache postgres',
 '21; 0 0 SEQUENCE SET public v2_profiles_id_seq postgres'
].join('\n');
const inventory={
 sourceProjectRef:'v2-source',
 backupCutoffUtc:'2026-11-12T19:00:00Z',
 archiveSha256:digest,
 tables:['auth.users','public.v2_profiles','allin_private.v2_provider_cache'],
 sequences:['public.v2_profiles_id_seq']
};

test('allows exact data-only TOC, expected sequences and independently asserted digest',()=>{
 assert.deepEqual(assessLogicalArchiveToc({toc,inventory,digest}),{
  accepted:true,reasons:[],tableCount:3,sequenceCount:1
 });
});
test('pg_restore list parser recognizes data-only entries',()=>{
 assert.deepEqual(parsePgRestoreToc(toc),[
  {kind:'table',name:'auth.users'},
  {kind:'table',name:'public.v2_profiles'},
  {kind:'table',name:'allin_private.v2_provider_cache'},
  {kind:'sequence',name:'public.v2_profiles_id_seq'}
 ]);
});
test('rejects extra unapproved owner table even if valid',()=>{
 const r=assessLogicalArchiveToc({
  toc:toc+'\n22; 0 0 TABLE DATA allin_private v2_coach_private postgres',
  inventory,digest
 });
 assert.equal(r.accepted,false);
 assert.ok(r.reasons.includes('table_inventory_mismatch'));
});
test('rejects missing Auth data, sequence and wrong digest',()=>{
 const r=assessLogicalArchiveToc({
  toc:toc.replace('18; 0 0 TABLE DATA auth users postgres\n','')
         .replace('21; 0 0 SEQUENCE SET public v2_profiles_id_seq postgres',''),
  inventory,digest:'b'.repeat(64)
 });
 assert.equal(r.accepted,false);
 for(const k of ['archive_digest_mismatch','table_inventory_mismatch','sequence_inventory_mismatch'])
  assert.ok(r.reasons.includes(k),k);
});
test('rejects executable or external restore entries instead of silently ignoring them',()=>{
 const r=assessLogicalArchiveToc({
  toc:toc+'\n22; 0 0 FUNCTION public outbound_worker postgres',
  inventory,digest
 });
 assert.equal(r.accepted,false);
 assert.ok(r.reasons.includes('unsafe_or_unsupported_toc_entries'));
});
test('disallows cron and vault table data and duplicate entries',()=>{
 const r=assessLogicalArchiveToc({
  toc:toc+'\n22; 0 0 TABLE DATA cron job postgres\n23; 0 0 TABLE DATA auth users postgres',
  inventory:{...inventory,tables:[...inventory.tables,'cron.job']},digest
 });
 assert.equal(r.accepted,false);
 assert.ok(r.reasons.includes('invalid_table_allowlist'));
 assert.ok(r.reasons.includes('duplicate_toc_entries'));
});
test('requires explicit source identity, cutoff, table allowlist and digest',()=>{
 const r=assessLogicalArchiveToc({toc,inventory:{},digest});
 assert.equal(r.accepted,false);
 for(const k of ['missing_source_ref','invalid_source_cutoff','archive_digest_mismatch','invalid_table_allowlist'])
  assert.ok(r.reasons.includes(k),k);
});
test('zero tables cannot claim a logical backup',()=>{
 const r=assessLogicalArchiveToc({toc:'; no entries',inventory:{...inventory,tables:[]},digest});
 assert.equal(r.accepted,false);
 assert.ok(r.reasons.includes('empty_archive_toc'));
 assert.ok(r.reasons.includes('invalid_table_allowlist'));
});
