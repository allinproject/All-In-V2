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
test("SQL reader exposes canonical identity needed for strict exchange readback",()=>{
 assert.match(candidate,/message_id uuid,user_id uuid,thread_id uuid,client_request_id uuid/);
 assert.match(candidate,/return query select m\.id,m\.user_id,m\.thread_id,m\.client_request_id/);
 assert.match(candidate,/unique \(user_id,client_request_id,role\)/);
 assert.match(candidate,/if v_existing=2 then/);
});
test("read window requires owner authentication and bounded cursor pagination",()=>{
 assert.match(candidate,/create function public\.v2_coach_read_messages/i);
 assert.match(candidate,/security invoker/i);
 assert.match(candidate,/p_limit not between 1 and 50/i);
 assert.match(candidate,/\(m\.created_at,m\.id\)<\(p_before_created_at,p_before_message_id\)/);
});
test("exact exchange reader is owner-invoker and cannot return a partial saved pair",()=>{
 const fn=candidate.match(/create function public\.v2_coach_read_exchange\([\s\S]*?\$function\$;/i)?.[0];
 assert.ok(fn);
 assert.match(fn,/security invoker/i);
 assert.match(fn,/auth\.uid\(\)/i);
 assert.match(fn,/p_expected_user_id is distinct from v_user/);
 assert.match(fn,/m\.client_request_id=p_client_request_id/);
 assert.match(fn,/if v_count<>2 then return;/);
 const grant=candidate.match(/grant execute on function public\.v2_coach_read_exchange\([\s\S]*?;/i)?.[0];
 assert.ok(grant);
 assert.match(grant,/to authenticated;/i);
 assert.match(replay,/Exact owner readback did not return the message pair/);
 assert.match(replay,/Wrong assistant message ID returned a partial exchange/);
 assert.match(replay,/B read A exact Coach exchange/);
});
test("Coach claim ledger and fenced writer remain service-only and single-owner",()=>{
 for(const clause of [
   "create table allin_private.v2_coach_turn_claims",
   "alter table allin_private.v2_coach_turn_claims enable row level security",
   "create function public.v2_coach_claim_turn",
   "create function public.v2_coach_finish_turn"
 ]) assert.ok(candidate.includes(clause));
 for(const fn of ["v2_coach_claim_turn","v2_coach_append_exchange","v2_coach_finish_turn"]){
  const grants=candidate.split("grant execute on function public."+fn+"(");
  assert.equal(grants.length,2,"Exactly one grant for "+fn);
  assert.match(grants[1].split(";")[0],/to service_role/);
  assert.doesNotMatch(grants[1].split(";")[0],/to authenticated/);
 }
 assert.match(candidate,/v_claim.execution_version is distinct from p_execution_version/);
 assert.match(candidate,/v_claim.lease_expires_at<=pg_catalog.clock_timestamp/);
 assert.match(candidate,/status='completed'/);
});
test("Coach lease takeover replay rejects an older producer and fingerprint changes",()=>{
 assert.match(replay,/Expired Coach lease did not advance fence/);
 assert.match(replay,/Stale provider appended after lease takeover/);
 assert.match(replay,/Stale provider created canonical message rows/);
 assert.match(replay,/Stale execution finalized newer Coach reply/);
 assert.match(replay,/Fingerprint change accepted/);
 assert.match(replay,/Completed request triggered new provider claim/);
});
test("SQL candidate contains exactly one physical owner and writer",()=>{
 for(const name of [
 "create table public.v2_coach_threads",
 "create table public.v2_coach_messages",
 "create table allin_private.v2_coach_turn_claims",
 "create function public.v2_coach_claim_turn",
 "create function public.v2_coach_append_exchange",
 "create function public.v2_coach_finish_turn",
 "create function public.v2_coach_read_exchange"
 ]) assert.equal(candidate.split(name).length,2,"Duplicate or missing "+name);
});
test("Coach request budget defaults OFF and rate admission precedes new claims",()=>{
 assert.match(candidate,/create table allin_private\.v2_coach_request_policy/);
 assert.match(candidate,/enabled boolean not null default false/);
 assert.match(candidate,/values\(true,false\)/);
 assert.match(candidate,/v_policy\.enabled is distinct from true/);
 assert.match(candidate,/pg_advisory_xact_lock\(pg_catalog\.hashtextextended\([\s\S]*?'v2-coach-rate:'/);
 assert.match(candidate,/v_minute>=v_policy\.requests_per_minute/);
 assert.match(candidate,/v_hour>=v_policy\.requests_per_hour/);
 assert.match(candidate,/v_month>=v_policy\.requests_per_month/);
 assert.match(replay,/Coach model spending was enabled by default/);
 assert.match(replay,/update allin_private\.v2_coach_request_policy set enabled=true/);
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
