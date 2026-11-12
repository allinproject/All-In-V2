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

test('new Nutrition, food, Progress, equipment, race and alternate-owner schemas require classification',()=>{
 for(const prefix of [
  'v2_nutrition_%','v2_progress_%','v2_food_%','v2_recipe_%',
  'v2_cookbook_%','v2_gear_%','v2_shoe_%','v2_meal_%','v2_pantry_%',
  'v2_macro_%','v2_body_%','v2_equipment_%','v2_race_%',
  'v2_personal_record_%','v2_achievement_%',
 ]) assert(reader.includes("'"+prefix+"'"),'Missing future-domain guard: '+prefix);
 for(const column of [
  'owner_id','athlete_id','actor_id','created_by_user_id',
  'account_id','profile_id','athlete_user_id',
 ]) assert(reader.includes("'"+column+"'"),'Missing alternate owner guard: '+column);
 assert(reader.includes('New domain requires explicit account export classification'));
 assert(reader.includes('Unreviewed alternate-key owner table requires export coverage'));
});
test('canonical snapshot and private paginated reader both redact blocked incoming follow requests',()=>{
 assert(source.includes('b.blocker_id=f.follower_id and b.blocked_id=v_user'));
 assert(source.includes('b.blocker_id=v_user and b.blocked_id=f.follower_id'));
 assert(reader.includes('b.blocker_id=t.follower_id AND b.blocked_id=$1'));
 assert(reader.includes('b.blocker_id=$1 AND b.blocked_id=t.follower_id'));
 assert(!reader.includes("UNION ALL SELECT 'community.pair_revisions'"));
 assert(!reader.includes("UNION ALL SELECT 'community.incoming_blocks'"));
});

test('Community action export excludes replay hashes and pair CAS internals in BOTH readers',()=>{
 const inline=source.slice(source.indexOf("'my_action_receipts'"),source.indexOf("'incoming_blocks_disclosed'"));
 const paged=reader.slice(reader.indexOf("ELSIF p_collection='community.my_action_receipts' THEN\n   --"),
  reader.indexOf("ELSE\n   v_query:=pg_catalog.format",reader.indexOf("ELSIF p_collection='community.my_action_receipts' THEN\n   --")));
 for(const field of ["'action_id'","'action'","'target_id'","'created_at'"]){
  assert(inline.includes(field),'Canonical inline action missing '+field);
  assert(paged.includes(field),'Paginated action missing '+field);
 }
 assert(!inline.includes("to_jsonb(a)"),'Raw Community action receipt cannot be exported');
 assert(!paged.includes("pg_catalog.to_jsonb(t)"),'Raw paginated action receipt cannot be exported');
 for(const sensitive of ["'payload_sha256'","'expected_version'","'result_version'"]){
  assert(!inline.includes(sensitive),'Private replay metadata exposed by inline export');
  assert(!paged.includes(sensitive),'Private replay metadata exposed by paginated export');
 }
 assert(!reader.includes("UNION ALL SELECT 'community.pair_revisions'"));
 assert(!reader.includes("UNION ALL SELECT 'community.incoming_blocks'"));
});

function guardSegment(sql){
 const start=sql.indexOf(' -- Future Nutrition, Progress');
 assert(start>=0,'Future-domain guard missing');
 const stop=sql.indexOf(' -- An unknown V2 domain',start);
 // The paginated source uses a different comment; isolate through the
 // specific final error/END IF rather than depending on prose.
 const end=sql.indexOf("USING ERRCODE='42501'; END IF;",sql.indexOf(
  'Unreviewed alternate-key owner table requires export coverage',start));
 assert(end>start,'Alternate owner guard missing');
 return sql.slice(start,end+"USING ERRCODE='42501'; END IF;".length);
}
test('inline and paginated account exports use identical future-domain and alternate-owner safeguards',()=>{
 assert.equal(guardSegment(source),guardSegment(reader),
  'Export protection drift: do not let a new owner table bypass either reader');
});
test('both export paths deny newly introduced food, activity, Progress, race and non-user_id owner relations',()=>{
 for(const sql of [source,reader]){
  const guard=guardSegment(sql);
  for(const name of ['v2_nutrition_%','v2_meal_%','v2_pantry_%','v2_macro_%',
   'v2_body_%','v2_equipment_%','v2_race_%','v2_personal_record_%',
   'v2_achievement_%']){
   assert(guard.includes("'"+name+"'"),'Missing unapproved domain '+name);
  }
  for(const col of ['owner_id','athlete_id','actor_id','created_by_user_id',
   'account_id','profile_id','athlete_user_id']){
   assert(guard.includes("'"+col+"'"),'Missing alternate-owner field '+col);
  }
  assert(guard.includes('Unreviewed alternate-key owner table requires export coverage'));
 }
});

test('export-request history retains owner provenance without leaking Auth session identifiers',()=>{
 const marker="ELSIF p_collection='allin_private.v2_account_export_requests_candidate' THEN";
 const start=reader.indexOf(marker);
 const end=reader.indexOf("\n ELSE\n  v_schema:=",start);
 assert(start>0&&end>start,'Missing explicit export-request privacy projection');
 const projection=reader.slice(start,end);
 for(const required of ["'user_id'","'request_id'","'status'","'requested_at'","'expires_at'"])
  assert(projection.includes(required),'Missing approved export metadata '+required);
 assert(!projection.includes("'session_id'"),'Auth session ID may not be in portable account data');
 assert(!projection.includes('pg_catalog.to_jsonb(t)'),'Raw export-job rows leak operational fields');
 assert(projection.includes('WHERE t.user_id=$1'),'Export-request rows must remain owner-scoped');
});
