import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static guard for a review-only SQL proposal. This does NOT claim PostgreSQL
// parsing, RLS behavior, grants, or two-user isolation tests.
const sql = readFileSync(
  new URL('../docs/architecture/sql/V2-COMMUNITY-PRIVACY-OWNER-CANDIDATE.sql', import.meta.url),
  'utf8',
);
const normalized = sql.toLowerCase();
const tableNames = [
  'v2_community_visibility',
  'v2_community_pair_revisions',
  'v2_community_follows',
  'v2_community_blocks',
  'v2_community_action_receipts',
];

function tableBody(name) {
  const match = normalized.match(new RegExp(
    'create\\s+table\\s+allin_private\\.' + name + '\\s*\\(([\\s\\S]*?)\\n\\);',
    'i',
  ));
  assert.ok(match, 'missing canonical table allin_private.' + name);
  return match[1];
}

test('Community privacy SQL remains an explicitly review-only proposal', () => {
  assert.match(sql, /REVIEW-ONLY/i);
  assert.match(sql, /NOT a Supabase migration/i);
  assert.match(sql, /NOT authorized for deployment/i);
  assert.match(sql, /public\.v2_profiles\(user_id\)/i);
  assert.doesNotMatch(normalized, /create\s+table\s+public\.v2_community_/i);
  assert.equal((normalized.match(/create\s+table\s+allin_private\.v2_community_/g) || []).length, 5);
});

test('every proposed Community relation stays private and has RLS with no direct API grant', () => {
  for (const name of tableNames) {
    const qualified = 'allin_private.' + name;
    assert.match(normalized, new RegExp('alter\\s+table\\s+' + qualified + '\\s+enable\\s+row\\s+level\\s+security'));
    assert.match(normalized, new RegExp('revoke\\s+all\\s+on\\s+' + qualified + '\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role'));
    assert.match(tableBody(name), /references public\.v2_profiles\(user_id\) on delete cascade/);
  }
  assert.doesNotMatch(sql, /^\s*grant\s/mi);
  assert.doesNotMatch(sql, /^\s*create\s+policy\s/mi);
  assert.doesNotMatch(sql, /^\s*create\s+(?:or\s+replace\s+)?function\s/mi);
  assert.doesNotMatch(sql, /^\s*create\s+(?:or\s+replace\s+)?procedure\s/mi);
});

test('visibility and relationship rows encode private-by-default directional semantics', () => {
  const visibility = tableBody('v2_community_visibility');
  assert.match(visibility, /profile_visibility\s+text\s+not null default 'private'/);
  assert.match(visibility, /profile_visibility in \('public','private'\)/);
  assert.match(visibility, /user_id uuid primary key/);

  const pair = tableBody('v2_community_pair_revisions');
  assert.match(pair, /primary key \(lower_user_id,upper_user_id\)/);
  assert.match(pair, /lower_user_id < upper_user_id/);

  const follows = tableBody('v2_community_follows');
  assert.match(follows, /primary key \(follower_id,followed_id\)/);
  assert.match(follows, /state in \('pending','approved'\)/);
  assert.match(follows, /follower_id <> followed_id/);
  assert.match(follows, /state='pending' and approved_at is null/);
  assert.match(follows, /state='approved' and approved_at is not null/);

  const blocks = tableBody('v2_community_blocks');
  assert.match(blocks, /primary key \(blocker_id,blocked_id\)/);
  assert.match(blocks, /blocker_id <> blocked_id/);
});

test('idempotency receipts bind actor, target, exact action and monotonic version', () => {
  const receipts = tableBody('v2_community_action_receipts');
  assert.match(receipts, /primary key \(actor_id,action_id\)/);
  assert.match(receipts, /target_id uuid not null references public\.v2_profiles\(user_id\) on delete cascade/);
  assert.match(receipts, /action in \([\s\S]*'follow'[\s\S]*'block'[\s\S]*'report'/);
  assert.match(receipts, /expected_version bigint not null check \(expected_version > 0\)/);
  assert.match(receipts, /result_version bigint not null check \(result_version > expected_version\)/);
  assert.match(receipts, /payload_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(receipts, /actor_id <> target_id/);
});
