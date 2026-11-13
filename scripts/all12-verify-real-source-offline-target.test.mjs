import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfflineTarget} from './all12-verify-real-source-offline-target.mjs';
const tables=[...Array.from({length:12},(_,i)=>'public.v2_table_'+i),
 'auth.users','auth.identities','auth.sessions','auth.refresh_tokens'];
const toc=tables.map((t,i)=>(i+1)+'; 0 0 TABLE DATA '+t.replace('.',' ')+' postgres').join('\n')
 +'\n17; 0 0 SEQUENCE SET auth refresh_tokens_id_seq postgres\n';
const capture={sourceProjectRef:'xarhuczrtzuiljmtdaeu',
 archiveSha256:'a'.repeat(64),catalogPreflightAndPostflightMatch:true,tables};
const input={capture,toc,digest:'a'.repeat(64),networkMode:'none',database:'all12_real_source_restore'};
test('offline preflight allows exact archive and isolated target',()=>{
 const x=assessOfflineTarget(input);
 assert.equal(x.safeToInspect,true);assert.equal(x.tables.length,16);
 assert.equal(assessOfflineTarget({...input,database:'postgres'}).safeToInspect,true);
});
test('reject mismatched digest, network and ambiguous target',()=>{
 const x=assessOfflineTarget({...input,digest:'b'.repeat(64),
  networkMode:'bridge',database:'template1'});
 assert.equal(x.safeToInspect,false);
 for(const b of ['digest_mismatch','target_has_network','unsafe_restore_database'])
  assert.ok(x.blockers.includes(b));
});
test('reject unsupported archive entries and missing table',()=>{
 const x=assessOfflineTarget({...input,toc:toc.replace('TABLE DATA public v2_table_0','TABLE public v2_table_0')});
 assert.equal(x.safeToInspect,false);
 assert.ok(x.blockers.includes('unsupported_archive_entry'));
 assert.ok(x.blockers.includes('archive_tables_do_not_match_capture'));
});
test('reject wrong source and missing capture consistency',()=>{
 const x=assessOfflineTarget({...input,capture:{...capture,
  sourceProjectRef:'impulecgsgaruvniuttc',catalogPreflightAndPostflightMatch:false}});
 assert.equal(x.safeToInspect,false);
 assert.ok(x.blockers.includes('source_ref_mismatch'));
 assert.ok(x.blockers.includes('unverified_source_inventory'));
});
