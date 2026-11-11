import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const candidate=readFileSync(root+"docs/architecture/sql/V2-COACH-OWNER-MIGRATION-CANDIDATE.sql","utf8");
const replay=readFileSync(root+"supabase/tests/v2_coach_owner_atomic_exchange_rollback.sql","utf8");

test("ALL-217 SQL remains a proposal, not an applied production migration",()=>{
 assert.match(candidate,/PROPOSAL ONLY|proposal ONLY|proposal ONLY|NOT an applied migration/i);
 assert.match(replay,/begin;/i);
 assert.match(replay,/rollback;\s*$/i);
});
test("Coach transcript tables are owner-bound with deletion cascades and RLS",()=>{
 assert.match(candidate,/create table public\.v2_coach_threads\s*\(/i);
 assert.match(candidate,/create table public\.v2_coach_messages\s*\(/i);
 assert.match(candidate,/foreign key \(thread_id,user_id\) references public\.v2_coach_threads\(id,user_id\) on delete cascade/i);
 assert.match(candidate,/alter table public\.v2_coach_threads enable row level security;/i);
 assert.match(candidate,/alter table public\.v2_coach_messages enable row level security;/i);
 assert.match(candidate,/using \(\(select auth\.uid\(\)\)=user_id\)/i);
});
test("signed-in client can read owner transcripts but cannot forge assistant replies",()=>{
 assert.match(candidate,/revoke all on table public\.v2_coach_messages from public,anon,authenticated,service_role;/i);
 assert.match(candidate,/grant select on table public\.v2_coach_messages to authenticated;/i);
 assert.match(candidate,/revoke all on function public\.v2_coach_append_exchange\([\s\S]*?from public,anon,authenticated,service_role;/i);
 const exchangeGrant=candidate.match(/grant execute on function public\.v2_coach_append_exchange\([\s\S]*?;/i)?.[0];
 assert.ok(exchangeGrant);
 assert.match(exchangeGrant,/to service_role;/i);
 assert.doesNotMatch(exchangeGrant,/to authenticated;/i);
});
test("atomic exchange has duplicate guards and exact two-message canonical readback",()=>{
 assert.match(candidate,/pg_advisory_xact_lock/i);
 assert.match(candidate,/on conflict\(id\) do nothing/);
 assert.match(candidate,/v_matched<>2/);
 assert.match(candidate,/client_request_id,role/i);
 assert.match(candidate,/raise exception 'Coach request IDs were reused with different content or identity'/);
});
test("read window requires owner authentication and bounded cursor pagination",()=>{
 assert.match(candidate,/create function public\.v2_coach_read_messages/i);
 assert.match(candidate,/security invoker/i);
 assert.match(candidate,/p_limit not between 1 and 50/i);
 assert.match(candidate,/\(m\.created_at,m\.id\)<\(p_before_created_at,p_before_message_id\)/);
});
test("rollback replay addresses two accounts, direct client write denial and atomic rollback",()=>{
 assert.match(replay,/coach-v2-a@example\.invalid/);
 assert.match(replay,/coach-v2-b@example\.invalid/);
 assert.match(replay,/set local role authenticated/);
 assert.match(replay,/set local role service_role/);
 assert.match(replay,/Authenticated client executed server-only exchange RPC/);
 assert.match(replay,/Orphan user message persisted/);
 assert.match(replay,/B read A transcript/);
});
