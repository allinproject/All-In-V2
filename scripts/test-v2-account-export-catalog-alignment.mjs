import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
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

const communityPosts=readFileSync('docs/architecture/sql/V2-COMMUNITY-CANONICAL-POSTS-OWNER-CANDIDATE.sql','utf8');
const foodLog=readFileSync('docs/architecture/candidates/ALL-247-food-log-first-writer.review.sql','utf8');
const foodLifecycle=readFileSync('docs/architecture/candidates/ALL-247-food-log-lifecycle.review.sql','utf8');
const trainingMedia=readFileSync('supabase/functions/_shared/trainingExportSupabaseStorage.mjs','utf8');
const mediaPages=readFileSync('supabase/functions/_shared/trainingExportPrivateMediaPages.mjs','utf8');

test('ALL-251 source ownership: canonical Community posts and ALL-247 food logs remain unapproved export sources',()=>{
 assert.match(communityPosts,/CREATE TABLE allin_private\.v2_community_posts\s*\(/i);
 assert.match(communityPosts,/owner_id uuid NOT NULL REFERENCES public\.v2_profiles\(user_id\)/i);
 assert.match(communityPosts,/source_id uuid/);
 assert.match(foodLog,/create table public\.v2_food_log_entries\s*\(/i);
 assert.match(foodLog,/user_id uuid not null references auth\.users\(id\)/i);
 assert.match(foodLog,/create table allin_private\.v2_food_log_write_actions\s*\(/i);
 assert.match(foodLifecycle,/add column deleted_at timestamptz/i);
 // Source models have not approved a photo object ownership contract.
 for(const candidate of [communityPosts,foodLog,foodLifecycle]){
  assert(!/\bobject_path\b|\bstorage_bucket\b|\bphoto_bucket\b/i.test(candidate),
   'New media ownership requires an exact ALL-251 export contract, not implicit inclusion');
 }
 for(const candidate of [source,reader]){
  assert(candidate.includes("'v2_food_%'"),'ALL-247 food owner history must fail closed');
  assert(candidate.includes("'owner_id'"),'Community posts owner_id must fail closed');
  if(candidate===reader){
   assert(candidate.includes("ELSIF p_collection='community.my_posts' THEN"),
    'Gated owner-only Community projection must remain explicit');
   const inventory=candidate.slice(0,candidate.indexOf('$inventory$;'));
   assert(!inventory.includes("'community.my_posts'"),
    'Community post projection must not enter the approved inventory before source acceptance');
   assert(inventory.includes("'complete',false"),
    'Community source review cannot set whole-export completion');
  }
  if(candidate===reader)assert(candidate.includes("'complete',false"),
   'Paginated inventory must remain incomplete until media/owner approvals');
 }
});

test('ALL-251 private media remains Training-only until explicit Community, Nutrition and Progress references exist',()=>{
 assert.match(trainingMedia,/v2-private-workout-objects/);
 assert.match(mediaPages,/collection!=='private_media'/);
 assert.match(mediaPages,/kind:'series'/);
 assert.match(mediaPages,/kind:'route'/);
 for(const candidate of [trainingMedia,mediaPages]){
  assert(!/v2-private-(?:community|nutrition|progress)-/i.test(candidate),
    'A new photo bucket must not be silently treated as Training media');
 }
 const migrations=readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql'));
 // Review candidates do NOT establish a deployed private-photo source.
 for(const file of migrations){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');
  assert(!/CREATE TABLE\s+(?:public|allin_private)\.v2_(?:community_posts|food_log_entries|progress_photos)\b/i.test(sql),
   'Source now migrated: reconcile ALL-251 source ownership before whole-account export');
 }
 assert(reader.includes("'complete',false"),'Unapproved domain must keep inventory incomplete');
});

test('ALL-251 owner-only Community post projection stays gated and excludes third-party material',()=>{
 const begin=reader.indexOf("ELSIF p_collection='community.my_posts' THEN");
 const end=reader.indexOf(" ELSIF p_collection LIKE 'community.%' THEN",begin);
 assert(begin>0&&end>begin,'Missing gated canonical Community post projection');
 const sql=reader.slice(begin,end);
 for(const field of ["'id'","'owner_id'","'kind'","'audience'","'title'",
  "'body'","'source_id'","'post_version'","'published_at'","'updated_at'"])
  assert(sql.includes(field),'Missing owner-post provenance '+field);
 assert(sql.includes("WHERE p.owner_id=$1"),'Post export must filter at source by owner');
 assert(sql.includes("ORDER BY p.published_at,p.id LIMIT $2 OFFSET $3"),
  'Post export must have deterministic bounded pagination');
 assert(!sql.includes('to_jsonb(p)'),'Raw Community table export is not approved');
 for(const forbidden of ['follower_id','followed_id','blocker_id','blocked_id','payload_sha256'])
  assert(!sql.includes(forbidden),'Projection may not include private third-party material');
 const inventory=reader.slice(0,reader.indexOf('$inventory$;'));
 assert(!inventory.includes("'community.my_posts'"),
  'Future Community source acceptance must be explicit, not a reader-side grant');
 assert(reader.includes("NOT (v_inventory->'collections' ? p_collection)"),
  'Candidate page reader must refuse any collection not approved in inventory');
});
