// ALL-222/243/246/251: review-only migration provenance and ordering check.
// No DB connection, schema mutation, environment credentials or production deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripCandidateTransactionWrappers} from './stage-v2-training-overlay.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const overlay=readFileSync(resolve(root,'scripts/test-v2-foundation-training-overlay-postgres.psql'),'utf8');
const names=[...overlay.matchAll(/^\\i \/tmp\/allin\/docs\/architecture\/sql\/([^\n\r ]+\.sql)$/gm)].map(m=>m[1]);
const files=[
 '20261113035500_v2_training_activity_identity_plan_review.sql',
 '20261113035501_v2_completed_activity_metrics_review.sql',
 '20261113035502_v2_training_completion_handoff_review.sql',
 '20261113035503_v2_training_activity_reads_deletion_review.sql',
 '20261113035504_v2_training_activity_account_export_review.sql',
];
test('five review-only migrations exactly preserve the existing ordered SQL graph',()=>{
 assert.equal(names.length,30);
 assert.equal(new Set(names).size,30);
 for(const file of files){
   const sql=readFileSync(resolve(root,'supabase/migrations',file),'utf8');
   assert.match(sql,/REVIEW ONLY/);
   assert.match(sql,/DO NOT MERGE\/DEPLOY|NO HOSTED DEPLOYMENT OR MERGE AUTHORIZED/);
   assert.doesNotMatch(sql,/^\\i\s/m);

 }
 // Source boundaries are checked directly below using marker split, avoiding assumptions about SQL sizes.
 let n=0;
 for(const file of files){
   const sql=readFileSync(resolve(root,'supabase/migrations',file),'utf8');
   const pieces=sql.split(/(?=^-- Source \d+: )/m).slice(1);
   assert.equal(pieces.length,6,file);
   for(const piece of pieces){
     const first=piece.indexOf('\n');
     const match=piece.slice(0,first).match(/^-- Source (\d+): (.+) \[Git blob [0-9a-f]{40}\]$/);
     assert.ok(match,'source manifest');
     const index=Number(match[1])-1;
     assert.equal(index,n++);
     assert.equal(match[2],names[index]);
     const original=readFileSync(resolve(root,'docs/architecture/sql',names[index]),'utf8');
     const expected=stripCandidateTransactionWrappers(original,names[index]).sql.split('\n')
       .filter(line=>!/^-- local overlay stripped file-level (BEGIN|COMMIT) \(atomic outer transaction\)$/.test(line)).join('\n').trim();
     assert.equal(piece.slice(first+1).trim(),expected,names[index]);
   }
 }
 assert.equal(n,30);
});
