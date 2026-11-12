import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = 'docs/architecture/sql/';
const candidate = 'V2-COACH-OWNER-MIGRATION-CANDIDATE.sql';
const exportFile = 'V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql';
const paginatedFile = 'V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql';

function checkDollarQuotes(source, name) {
  const stripped = source.split('\n').map(line => /^\s*--/.test(line) ? '' : line).join('\n');
  const tokens = stripped.match(/\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$/g) ?? [];
  let open = null;
  for (const token of tokens) {
    if (open === null) open = token;
    else if (open === token) open = null;
  }
  assert.equal(open, null, name + ': unclosed PostgreSQL dollar literal');
}

function validateOwnerCandidate(ddl) {
  checkDollarQuotes(ddl, candidate);
  for (const table of [
    'public.v2_coach_threads','public.v2_coach_messages',
    'allin_private.v2_coach_turn_claims'
  ]) {
    assert(ddl.includes('create table ' + table), 'missing canonical Coach table: ' + table);
    assert(ddl.includes('alter table ' + table + ' enable row level security'), 'RLS missing: ' + table);
  }
  assert(ddl.includes('constraint v2_coach_threads_one_per_owner unique (user_id)'),
    'one persistent thread per owner must be database-enforced');
  assert(ddl.includes('v2-coach-owner-thread:'),
    'first-open creation must serialize by owner, not by caller-generated thread UUID');
  assert(ddl.includes('auth.uid()') && ddl.includes('p_expected_user_id is distinct from v_user'),
    'thread creation must bind the authenticated owner');
  for (const operation of [
    'v2_coach_create_thread','v2_coach_read_messages','v2_coach_read_exchange',
    'v2_coach_claim_turn','v2_coach_append_exchange','v2_coach_finish_turn'
  ]) assert(ddl.includes('create function public.' + operation), 'missing Coach RPC: ' + operation);
  assert(ddl.includes('execution_version') && ddl.includes('request_fingerprint') &&
    ddl.includes('lease_expires_at'), 'durable request fencing fields missing');
  assert(ddl.includes('on delete cascade'), 'owner deletion cascade is not declared');
  assert(!ddl.includes('v2_coach_message_actions'),
    'retired duplicate Coach action-receipt store must not return');
  assert(ddl.includes('default false'), 'Coach request admission must remain default-OFF');
}

function validateExport(source, paginated) {
  assert(source.includes('create or replace function public.v2_export_my_account_snapshot'),
    'Coach export must extend the canonical owner export');
  for (const token of [
    'v2-coach-account-fragment-candidate-v2',
    "'coach_conversation'", "'threads'", "'messages'",
    'v2_coach_turn_claims','Private pre-provider claims'
  ]) assert(source.includes(token), 'missing canonical Coach export contract: ' + token);
  assert(!source.includes('v2_coach_message_actions') && !source.includes('message_actions'),
    'retired Coach action-receipt table must not be exported');
  assert(source.includes('where t.user_id=v_user') && source.includes('5000000'),
    'owner binding or inline export cap missing');
  assert(paginated.includes("('allin_private','v2_coach_turn_claims')"),
    'operational Coach claims must remain in the complete owner-table inventory');
  assert(paginated.includes("'internalOperationalTables'") &&
    paginated.includes("'allin_private.v2_coach_turn_claims'"),
    'operational Coach claims must be classified separately from portable collections');
  assert(!/v2_coach_message_actions|message_actions/.test(paginated),
    'retired Coach message-action schema still appears in paginated export');
  assert(source.includes('New personal data tables require export coverage') &&
    source.includes('Account export needs Storage coverage'),
    'existing fail-closed export guards must survive');
}

if (process.argv.includes('--self-test')) {
  assert.throws(() => validateOwnerCandidate('begin; commit;'), /missing canonical Coach table/);
  assert.throws(() => validateExport('', ''), /canonical owner export/);
  assert.throws(() => checkDollarQuotes('do $$ begin; end $;', 'bad'), /unclosed/);
  console.log('PASS: canonical Coach owner static guard negative self-tests');
} else {
  validateOwnerCandidate(readFileSync(root + candidate, 'utf8'));
  validateExport(readFileSync(root + exportFile, 'utf8'),
    readFileSync(root + paginatedFile, 'utf8'));
  console.log('PASS: canonical Coach owner, one-thread, export and operational-claims source checks');
}
