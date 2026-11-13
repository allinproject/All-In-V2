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
test('all 43 authoritative owner tables match the canonical snapshot allowlist exactly',()=>{
 const owned=sourceTables(source),candidate=candidateTables(reader);
 assert.equal(owned.length,43);
 assert(owned.includes('public.v2_goal_event_edition_links'),
  'Event edition links must remain part of explicit owner export review');
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

test('ALL-251 gated Food Log projection exports deleted owner history, not private action fingerprints',()=>{
 const marker="ELSIF p_collection='public.v2_food_log_entries' THEN";
 const begin=reader.indexOf(marker),end=reader.indexOf(" ELSIF p_collection='public.v2_hydration_events' THEN",begin);
 assert(begin>0&&end>begin,'Gated ALL-247 food projection missing');
 const projection=reader.slice(begin,end);
 for(const field of ["'id'","'user_id'","'consumed_at'","'local_date'",
  "'timezone_name'","'meal_slot'","'label'","'quantity'","'unit'",
  "'kcal'","'nutrition_source'","'revision'","'created_at'",
  "'updated_at'","'deleted_at'"])
   assert(projection.includes(field),'Food history field absent: '+field);
 assert(projection.includes("WHERE e.user_id=$1"),'Food events must be owner-filtered at source');
 assert(projection.includes("ORDER BY e.consumed_at,e.id LIMIT $2 OFFSET $3"));
 assert(!projection.includes("e.deleted_at IS NULL"),'Deleted events must remain portable history');
 for(const secret of ['request_fingerprint','result_revision','v2_food_log_write_actions','to_jsonb(e)'])
   assert(!projection.includes(secret),'Food export leaked action internals: '+secret);
 const inventory=reader.slice(0,reader.indexOf('$inventory$;'));
 assert(!inventory.includes("('public','v2_food_log_entries')"),'Food export cannot be enabled until domain accepted');
 assert(inventory.includes("'complete',false"),'Full export must remain off');
});

test('ALL-251 gated Hydration and Fuel action projections retain owner privacy without enabling complete export',()=>{
 const hydration=reader.indexOf("ELSIF p_collection='public.v2_hydration_events' THEN");
 const actions=reader.indexOf("ELSIF p_collection IN ('allin_private.v2_food_log_write_actions',",hydration);
 const community=reader.indexOf("ELSIF p_collection='community.my_posts' THEN",actions);
 assert(hydration>0&&actions>hydration&&community>actions,
   'Current canonical Fuel projection branches missing or reordered');
 const hydr=reader.slice(hydration,actions),receipts=reader.slice(actions,community);
 for(const field of ["'id'","'user_id'","'event_kind'","'volume_ml'",
  "'original_volume'","'original_unit'","'deleted_at'","'revision'"])
   assert(hydr.includes(field),'Hydration owner history missing '+field);
 assert(hydr.includes("WHERE h.user_id=$1"),'Hydration source must be owner-scoped');
 assert(hydr.includes("ORDER BY h.occurred_at,h.id LIMIT $2 OFFSET $3"),
   'Hydration must be deterministic and bounded');
 assert(!hydr.includes("h.deleted_at IS NULL"),'Deleted hydration events remain owner-portable');
 for(const key of ["'user_id'","'action_id'","'result_id'","'result_revision'","'created_at'"])
   assert(receipts.includes(key),'Portable action receipt missing '+key);
 assert(receipts.includes("WHERE a.user_id=$1"),'Private action receipt must be owner-scoped');
 for(const secret of ["'request_fingerprint'","'payload_sha256'","'client_secret'","to_jsonb(a)"])
   assert(!receipts.includes(secret),'Internal Fuel replay material exposed');
 const inv=reader.slice(0,reader.indexOf('$inventory$;'));
 for(const collection of ["('public','v2_food_log_entries')",
   "('allin_private','v2_food_log_write_actions')",
   "('public','v2_hydration_events')",
   "('allin_private','v2_hydration_actions')"])
    assert(!inv.includes(collection),'Unapproved Fuel table was prematurely registered: '+collection);
 assert(inv.includes("'complete',false"));
});

test('Community indirect Auth deletion cascade requires both canonical foreign-key links',()=>{
 const foundation=readFileSync(
  'supabase/migrations/20261110021548_v2_auth_profile_legal_foundation.sql','utf8');
 assert.match(foundation,
  /create table if not exists public\.v2_profiles\s*\([\s\S]*?user_id uuid primary key references auth\.users\(id\) on delete cascade/i,
  'Profile owner must cascade from Auth');
 assert.match(communityPosts,
  /CREATE TABLE allin_private\.v2_community_posts\s*\([\s\S]*?owner_id uuid NOT NULL REFERENCES public\.v2_profiles\(user_id\) ON DELETE CASCADE/i,
  'Community post must cascade through the canonical Profile owner');
 assert(reader.includes("WHERE p.owner_id=$1"),
  'Community export must use the same exact owner key as cascade');
});

test('ALL-251 review-only deletion graph scanner remains private and release-blocking',()=>{
 const graph=readFileSync(
  'docs/architecture/sql/V2-ACCOUNT-DELETION-OWNER-GRAPH-PREFLIGHT-REVIEW.sql','utf8');
 const claim=readFileSync(
  'supabase/migrations/20261111123939_v2_deletion_claim_fail_closed_storage_and_owner_coverage.sql','utf8');
 const completion=readFileSync(
  'supabase/migrations/20261111130824_v2_deletion_completion_verify_auth_sessions_and_owner_rows.sql','utf8');
 for(const value of ["'owner_id'","'athlete_id'","'actor_id'","'follower_id'",
   "'followed_id'","'blocker_id'","'blocked_id'","'lower_user_id'",
   "'upper_user_id'","'target_id'","'profile_id'"]){
   assert(graph.includes(value),'Missing owner or relationship column '+value);
 }
 assert.match(graph,/WITH RECURSIVE cascade_reachable/);
 assert.match(graph,/f\.confdeltype='c'/);
 assert.match(graph,/relationship_or_actor_retention_policy_required/);
 assert.match(graph,/unreviewed_storage_bucket_cleanup/);
 assert.match(graph,/audit_retention_policy_required/);
 assert.match(graph,/REVOKE ALL ON FUNCTION allin_private\.v2_deletion_owner_graph_gaps_review\(\)/);
 assert.match(claim,/execution_enabled=true/);
 assert.match(claim,/if exists\(select 1 from storage\.buckets\)/i);
 assert.match(completion,/if exists\(select 1 from storage\.buckets\)/i);
 assert(!claim.includes('v2_deletion_owner_graph_gaps_review'),
  'Review scanner cannot be represented as an installed deletion-claim release gate');
});

test('ALL-251 claim and completion review integration preserves both release guards',()=>{
 const sql=readFileSync(
  'docs/architecture/sql/V2-ACCOUNT-DELETION-CLAIM-COMPLETION-GRAPH-GATE-REVIEW.sql','utf8');
 const claim=sql.slice(sql.indexOf('create or replace function public.v2_claim_account_deletion_for_processing('),
   sql.indexOf('create or replace function public.v2_record_account_deletion_completion('));
 const completion=sql.slice(sql.indexOf('create or replace function public.v2_record_account_deletion_completion('));
 assert.match(sql,/audit_retention_policy_required/);
 for(const fragment of [claim,completion]){
  assert(fragment.includes('perform allin_private.v2_deletion_assert_approved_coverage_review();'),
   'Both canonical deletion phases must enforce the graph coverage gate');
  assert(!fragment.includes('drop table')&&!fragment.includes('delete from auth.users'),
   'Source gate must not perform destructive actions');
 }
 assert(claim.includes('execution_enabled=true'),'Claim must preserve worker OFF switch');
 assert(claim.includes('pg_advisory_xact_lock'),'Claim must preserve owner serialization');
 assert(claim.includes("status='processing'"),'Claim must preserve processing transition');
 assert(completion.includes('auth.sessions'),'Completion must verify session absence');
 assert(completion.includes('v2_account_deletion_execution_audit'),
  'Completion must preserve durable audit readback');
 const workflow=readFileSync('.github/workflows/v2-foundation-clean-replay.yml','utf8');
 assert(workflow.includes('test-all251-deletion-claim-graph-gate-local.psql'));
 assert(!sql.includes('ALTER TABLE allin_private.v2_account_deletion_processor_config'),
  'Review SQL must not arm the processor');
});

test('ALL-217/230 private Coach budget and athlete restrictions stay outside approved export inventory',()=>{
 const pending=[
  ['public','v2_training_athlete_restrictions'],
  ['allin_private','v2_training_restriction_certifications'],
  ['allin_private','v2_training_restriction_action_receipts'],
  ['allin_private','v2_coach_budget_periods'],
  ['allin_private','v2_coach_budget_reservations'],
 ];
 const registered=candidateTables(reader);
 const inline=sourceTables(source);
 for(const [schema,table] of pending){
  const qualified=schema+'.'+table;
  assert(!registered.includes(qualified),
   'Private owner table must not enter paginated export inventory until consent and acceptance: '+qualified);
  assert(!inline.includes(qualified),
   'Private owner table must not silently enter inline export allowlist: '+qualified);
  const start=reader.indexOf("ELSIF p_collection='"+qualified+"' THEN");
  assert(start>0,'Staged owner-only export projection missing: '+qualified);
  const next=reader.indexOf(' ELSIF p_collection=',start+8);
  assert(next>start,'Projection branch must be isolated: '+qualified);
  const sql=reader.slice(start,next);
  assert(sql.includes('WHERE t.user_id=$1'),'Export projection must filter owner at source: '+qualified);
  assert(sql.includes('LIMIT $2 OFFSET $3'),'Export projection must be bounded: '+qualified);
  assert(sql.includes('pg_catalog.jsonb_build_object('),'Never expose raw table rows: '+qualified);
  assert(!sql.includes('pg_catalog.to_jsonb(t)'),'Raw owner export disallowed: '+qualified);
 }
 const inventory=reader.slice(0,reader.indexOf('$inventory$;'));
 assert(inventory.includes("'complete',false"),'Incomplete user export must never report complete');
 assert(reader.includes("NOT (v_inventory->'collections' ? p_collection)"),
  'Even staged projections must be blocked until approved inventory registration');
});
test('ALL-217/230 private export redacts replay hashes, provider correlators and internal reservation identifiers',()=>{
 const start=reader.indexOf("ELSIF p_collection='public.v2_training_athlete_restrictions' THEN");
 const end=reader.indexOf(" ELSIF p_collection='allin_private.v2_account_export_requests_candidate' THEN",start);
 assert(start>0&&end>start,'Coach/Training projections must be one review-only scope');
 const slice=reader.slice(start,end);
 const sqlOnly=slice.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
 for(const forbidden of [
  'request_hash','client_request_id','reservation_id',
  'request_fingerprint','service_role','api_key'
 ]){
  assert(!sqlOnly.includes("''"+forbidden+"''"),
   'Private/internal field leaked into athlete export: '+forbidden);
 }
 assert(!sqlOnly.includes('pg_catalog.to_jsonb(t)'),
  'Unredacted raw private records cannot enter athlete export');
 for(const expected of [
  'subject','status','certified_revision','inventory_digest',
  'result_revision','period_start','held_usd',
  'spent_usd','settled_usd','metered_input_tokens',
  'metered_output_tokens'
 ])assert(sqlOnly.includes("''"+expected+"''"),
  'Portable athlete history missing '+expected);
 const certStart=reader.indexOf("ELSIF p_collection='allin_private.v2_training_restriction_certifications' THEN");
 const certEnd=reader.indexOf(' ELSIF p_collection=',certStart+8);
 assert(certStart>0&&certEnd>certStart,'Review-only certification export projection missing');
 const certSlice=reader.slice(certStart,certEnd);
 assert(certSlice.includes("''inventory_digest'',t.inventory_digest"),
  'A restored Training certification must carry the digest that guards reader/replay');
 assert(certSlice.includes('WHERE t.user_id=$1'),
  'Certification digest must stay owner-scoped');
 const r=readFileSync('docs/architecture/sql/V2-TRAINING-RESTRICTION-WRITER-REVIEW-CANDIDATE.sql','utf8');
 const c=readFileSync('docs/architecture/sql/V2-TRAINING-ATHLETE-RESTRICTIONS-OWNER-REVIEW-CANDIDATE.sql','utf8');
 const b=readFileSync('docs/architecture/sql/V2-COACH-BUDGET-LEDGER-REVIEW-CANDIDATE.sql','utf8');
 for(const candidate of [r,c,b])assert(candidate.includes('ON DELETE CASCADE'),
  'Owner deletion must cascade to each new private data domain');
 assert(!reader.includes("'completeUserExport',true"),'Do not promise complete export before approval');
});

test('ALL-217/230 private owner tables must cascade with direct Auth owner FK before deletion may arm',()=>{
 const cases=[
  ['docs/architecture/sql/V2-TRAINING-ATHLETE-RESTRICTIONS-OWNER-REVIEW-CANDIDATE.sql',
   ['public.v2_training_athlete_restrictions','allin_private.v2_training_restriction_certifications']],
  ['docs/architecture/sql/V2-TRAINING-RESTRICTION-WRITER-REVIEW-CANDIDATE.sql',
   ['allin_private.v2_training_restriction_action_receipts']],
  ['docs/architecture/sql/V2-COACH-BUDGET-LEDGER-REVIEW-CANDIDATE.sql',
   ['allin_private.v2_coach_budget_periods','allin_private.v2_coach_budget_reservations']]
 ];
 for(const [file,tables] of cases){
  const ddl=readFileSync(file,'utf8');
  for(const table of tables){
   const token='CREATE TABLE '+table+' (';
   const pos=ddl.indexOf(token);
   assert(pos>=0,'Canonical owner table not declared: '+table);
   const end=ddl.indexOf('\n);',pos);
   assert(end>pos,'Owner relation definition is unbounded: '+table);
   const definition=ddl.slice(pos,end);
   assert.match(definition,/user_id uuid (?:NOT NULL|PRIMARY KEY) REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
    'Auth direct owner cascade is required for privacy deletion: '+table);
  }
 }
 const graph=readFileSync(
  'docs/architecture/sql/V2-ACCOUNT-DELETION-OWNER-GRAPH-PREFLIGHT-REVIEW.sql','utf8');
 assert(graph.includes('cascade_reachable'));
 assert(graph.includes('relationship_or_actor_retention_policy_required'));
 const snapshot=sourceTables(source),inventory=candidateTables(reader);
 for(const table of cases.flatMap(x=>x[1])){
  assert(!snapshot.includes(table)&&!inventory.includes(table),
   'Deletion cascade alone must never authorize incomplete account exports: '+table);
 }
});
