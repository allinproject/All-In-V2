-- ALL-244 / ALL-222 / ALL-251: REVIEW-ONLY Community privacy owner candidate.
-- NOT a Supabase migration and NOT authorized for deployment.
-- Promote ONLY after owner schema review + isolated two-user PostgreSQL RLS,
-- concurrent mutation and account-deletion replays. Do NOT apply to V1/main.
-- Identity: public.v2_profiles.user_id remains canonical. Do not duplicate
-- display name, avatar, email or legal/account settings in Community.
-- The Community writer/reader must use owner-checked server RPCs with
-- explicit authenticated session/account existence and post/block ACLs.
-- No public/anon/authenticated/service_role direct DML is granted here.

-- Private-by-default owner Community visibility. This is the social audience
-- source of truth, NOT a second profile identity or generic settings store.
create table allin_private.v2_community_visibility (
  user_id uuid primary key references public.v2_profiles(user_id) on delete cascade,
  profile_visibility text not null default 'private'
    check (profile_visibility in ('public','private')),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

-- One authoritative revision per unordered pair of athletes. This is
-- the CAS/locking source for follow, request, approve, block, unblock and
-- their replays. Other per-row versions MUST NOT become competing CAS owners.
-- Server creates/locks this exact row transactionally (ordered UUIDs).
create table allin_private.v2_community_pair_revisions (
  lower_user_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  upper_user_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (lower_user_id,upper_user_id),
  constraint v2_community_pair_sorted check (lower_user_id < upper_user_id)
);

-- One directional relationship from follower to followed athlete. An accepted
-- relation must have been approved by the recipient if private at acceptance.
-- RLS is not sufficient for approval authorization: server must lock and
-- re-read the followed athlete's current visibility and block state.
create table allin_private.v2_community_follows (
  follower_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  followed_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  state text not null check (state in ('pending','approved')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (follower_id,followed_id),
  constraint v2_community_follows_no_self check (follower_id <> followed_id),
  constraint v2_community_follows_approval_time check (
    (state='pending' and approved_at is null) or
    (state='approved' and approved_at is not null)
  )
);
create index v2_community_follows_recipient_state_idx
  on allin_private.v2_community_follows (followed_id,state,requested_at desc);

-- A block is directional. Both directions must be consulted to determine
-- whether an account or post is visible. Prevent followers/requests from
-- surviving a block in the same server-side transaction.
create table allin_private.v2_community_blocks (
  blocker_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  blocked_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id,blocked_id),
  constraint v2_community_blocks_no_self check (blocker_id <> blocked_id)
);
create index v2_community_blocks_target_idx
  on allin_private.v2_community_blocks (blocked_id,blocker_id);

-- One durable action result per actor + stable client-generated action ID.
-- The writer must compare fingerprint and exact target/action on replay and
-- REFUSE to treat a mismatched retry as success. Serialize both sides of
-- follow/block transactions, not only the same action ID.
create table allin_private.v2_community_action_receipts (
  actor_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  action_id uuid not null,
  target_id uuid not null references public.v2_profiles(user_id) on delete cascade,
  action text not null check (action in (
    'follow','request_follow','cancel_request','unfollow',
    'approve_request','reject_request','block','unblock','report'
  )),
  expected_version bigint not null check (expected_version > 0),
  result_version bigint not null check (result_version > expected_version),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (actor_id,action_id),
  constraint v2_community_action_receipts_not_self check (actor_id <> target_id)
);
create index v2_community_action_receipts_actor_recent
  on allin_private.v2_community_action_receipts (actor_id,created_at desc);

-- Private tables have no direct API grants and RLS is enabled for defense in
-- depth. This intentionally creates NO user-facing SELECT, INSERT, UPDATE or
-- DELETE policy; the approved server reader/writer is not implemented yet.
alter table allin_private.v2_community_visibility enable row level security;
alter table allin_private.v2_community_pair_revisions enable row level security;
alter table allin_private.v2_community_follows enable row level security;
alter table allin_private.v2_community_blocks enable row level security;
alter table allin_private.v2_community_action_receipts enable row level security;

revoke all on allin_private.v2_community_visibility from public,anon,authenticated,service_role;
revoke all on allin_private.v2_community_pair_revisions from public,anon,authenticated,service_role;
revoke all on allin_private.v2_community_follows from public,anon,authenticated,service_role;
revoke all on allin_private.v2_community_blocks from public,anon,authenticated,service_role;
revoke all on allin_private.v2_community_action_receipts from public,anon,authenticated,service_role;

comment on table allin_private.v2_community_visibility is
  'Proposed private-by-default Community visibility; owner-approved backend only.';
comment on table allin_private.v2_community_pair_revisions is
  'Proposed sole relationship-pair CAS revision and concurrency row.';
comment on table allin_private.v2_community_follows is
  'Proposed directed follow/approval state; no direct client write or private-profile access.';
comment on table allin_private.v2_community_blocks is
  'Proposed directional block; both directions deny visibility and interactions.';
comment on table allin_private.v2_community_action_receipts is
  'Proposed idempotent Community action evidence; exact CAS/owner binding pending reviewed writer.';

-- APPROVAL / VALIDATION GATES (NOT IMPLEMENTED BY THIS CANDIDATE)
-- 1. Compare against canonical ALL-244 owner and ALL-222 migration review.
-- 2. Do not implement new public profiles; read identity from v2_profiles and
--    respect account deletion, profile defaults, and session-existence rules.
-- 3. Enforce a private actor's approval, rejection and pending request scope
--    within the SAME server transaction, including both block directions.
-- 4. Lock the v2_community_pair_revisions row for actor+target and use it
--    as the ONLY relationship CAS version; lock profile visibility rows too
--    when approvals or public/private changes depend on that setting.
--    Prevent follow/block races;
--    use expected-version CAS and fingerprint-checked idempotency.
-- 5. Reject reports without an independently reviewed moderation intake;
--    the action receipt table is NOT a report store or moderation queue.
-- 6. A future read RPC must return owner/viewer-verified, already filtered
--    posts/events/location. Never send unauthorized bytes to the device.
-- 7. Composite ownership for posts, comments, event links, and owner-delete
--    dependencies must be approved in separate ALL-244 slices.
-- 8. Isolated DB tests: two users + anonymous, blocked each direction,
--    public->private switch, pending->approved->unfollow, stale version,
--    duplicate replay with changed action/payload, concurrent request/block,
--    deletion cascade, cross-owner RLS and no direct schema/API access.
