import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('docs/architecture/sql/V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql','utf8');
const reader=readFileSync('docs/architecture/sql/V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql','utf8');
function sourceTables(text){
 const start=text.indexOf('and not (');
 const end=text.indexOf(") then\n   raise exception 'New personal data tables",start);
 assert(start>=0&&end>start);
 const groups=[...text.slice(start,end).matchAll(/c\.relname=any\(array\[([\s\S]*?)\]\)/g)];
 assert.equal(groups.length,4,'canonical owner allowlist shape changed');
 return groups.flatMap((m,i)=>
  [...m[1].matchAll(/'(v2_[a-z0-9_]+)'/g)].map(x=>
    (i%2===0?'public':'allin_private')+'.'+x[1])).sort();
}
function candidateTables(text){
 const fragment=text.split('FROM (VALUES')[1]?.split(') AS reviewed')[0];
 assert(fragment,'candidate registry absent');
 return [...fragment.matchAll(/\('(public|allin_private)','(v2_[a-z0-9_]+)'\)/g)]
  .map(m=>m[1]+'.'+m[2]).sort();
}
test('all 42 authoritative owner tables match the canonical snapshot allowlist exactly',()=>{
 const owned=sourceTables(source),candidate=candidateTables(reader);
 assert.equal(owned.length,42);
 assert.equal(new Set(candidate).size,candidate.length);
 assert.deepEqual(candidate,owned,'any added owner table must be explicitly reviewed and paginated');
});
test('private relationship policies remain explicit and incoming blocks are not exposed',()=>{
 for(const name of [
  'community.outgoing_follows','community.incoming_follow_requests',
  'community.outgoing_blocks','community.my_action_receipts',
  'v2_community_pair_revisions',
 ]) assert(reader.includes(name));
 assert(!reader.includes("UNION ALL SELECT 'community.incoming_blocks'"));
 assert(reader.includes("'complete',false"),'unreviewed domains cannot appear complete');
 assert(reader.includes('transaction_isolation'), 'snapshot guarantee must be enforced');
 assert(reader.includes('v2_account_export_authorize_request_candidate'),
  'session and exact request gate is required');
});
test('reader has no direct anonymous or authenticated execute permissions',()=>{
 assert(reader.includes('FROM PUBLIC,anon,authenticated,service_role'));
 assert(reader.includes('TO service_role'));
 assert(!/TO authenticated;/i.test(reader));
});
