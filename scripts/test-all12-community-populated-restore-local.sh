#!/usr/bin/env bash
# ALL-12 Community private relationship graph populated local recovery only.
set -euo pipefail
test "${CI:-}" = "1"
db="${1:?local Supabase DB container required}"
test "$db" = "$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)"
sql() { docker exec -i "$db" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1; }
sql <<'SQL'
DO $gate$
BEGIN
 IF to_regclass('allin_private.v2_community_visibility') IS NULL
 OR to_regclass('allin_private.v2_community_pair_revisions') IS NULL
 OR to_regclass('allin_private.v2_community_follows') IS NULL
 OR to_regclass('allin_private.v2_community_blocks') IS NULL
 OR to_regclass('allin_private.v2_community_action_receipts') IS NULL
 THEN RAISE EXCEPTION 'Community recovery graph incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM allin_private.v2_community_visibility)
 OR EXISTS(SELECT 1 FROM allin_private.v2_community_pair_revisions)
 OR EXISTS(SELECT 1 FROM allin_private.v2_community_follows)
 OR EXISTS(SELECT 1 FROM allin_private.v2_community_blocks)
 OR EXISTS(SELECT 1 FROM allin_private.v2_community_action_receipts)
 THEN RAISE EXCEPTION 'Community recovery requires empty disposable graph'; END IF;
END $gate$;
INSERT INTO auth.users(id) VALUES
 ('a7171717-7171-4717-8717-717171717171'),
 ('b7171717-7171-4717-8717-717171717171');
INSERT INTO allin_private.v2_community_visibility(user_id,profile_visibility,version)
VALUES ('a7171717-7171-4717-8717-717171717171','private',1),
 ('b7171717-7171-4717-8717-717171717171','public',2);
INSERT INTO allin_private.v2_community_pair_revisions(lower_user_id,upper_user_id,version)
VALUES ('a7171717-7171-4717-8717-717171717171','b7171717-7171-4717-8717-717171717171',3);
INSERT INTO allin_private.v2_community_follows(follower_id,followed_id,state,approved_at)
VALUES ('a7171717-7171-4717-8717-717171717171','b7171717-7171-4717-8717-717171717171','pending',null),
 ('b7171717-7171-4717-8717-717171717171','a7171717-7171-4717-8717-717171717171','approved',now());
INSERT INTO allin_private.v2_community_blocks(blocker_id,blocked_id)
VALUES ('a7171717-7171-4717-8717-717171717171','b7171717-7171-4717-8717-717171717171');
INSERT INTO allin_private.v2_community_action_receipts(actor_id,action_id,target_id,action,expected_version,result_version,payload_sha256)
VALUES
 ('a7171717-7171-4717-8717-717171717171','a7272727-7272-4727-8727-727272727272',
  'b7171717-7171-4717-8717-717171717171','request_follow',1,2,repeat('a',64)),
 ('b7171717-7171-4717-8717-717171717171','b7272727-7272-4727-8727-727272727272',
  'a7171717-7171-4717-8717-717171717171','approve_request',2,3,repeat('b',64));
SQL
manifest() {
sql <<'SQL'
SELECT label||'|'||n||'|'||digest FROM (
 SELECT 'visibility' label,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY user_id),'')) digest FROM allin_private.v2_community_visibility t
 UNION ALL SELECT 'pairs',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY lower_user_id,upper_user_id),'')) FROM allin_private.v2_community_pair_revisions t
 UNION ALL SELECT 'follows',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY follower_id,followed_id),'')) FROM allin_private.v2_community_follows t
 UNION ALL SELECT 'blocks',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY blocker_id,blocked_id),'')) FROM allin_private.v2_community_blocks t
 UNION ALL SELECT 'receipts',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY actor_id,action_id),'')) FROM allin_private.v2_community_action_receipts t
) s ORDER BY label;
SQL
}
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 5
docker exec "$db" pg_dump -U postgres -d postgres -Fc --data-only \
 -t allin_private.v2_community_visibility \
 -t allin_private.v2_community_pair_revisions \
 -t allin_private.v2_community_follows \
 -t allin_private.v2_community_blocks \
 -t allin_private.v2_community_action_receipts \
 -f /tmp/all12-community.dump
sql <<'SQL'
DELETE FROM allin_private.v2_community_action_receipts;
DELETE FROM allin_private.v2_community_blocks;
DELETE FROM allin_private.v2_community_follows;
DELETE FROM allin_private.v2_community_pair_revisions;
DELETE FROM allin_private.v2_community_visibility;
SQL
docker exec "$db" pg_restore -U postgres -d postgres --data-only --exit-on-error /tmp/all12-community.dump
after="$(manifest)"
test "$before" = "$after" || { diff -u <(echo "$before") <(echo "$after"); exit 1; }
sql <<'SQL'
DO $check$
BEGIN
 IF (SELECT count(*) FROM allin_private.v2_community_visibility)<>2
 OR (SELECT count(*) FROM allin_private.v2_community_follows)<>2
 OR (SELECT count(*) FROM allin_private.v2_community_blocks)<>1
 OR (SELECT count(*) FROM allin_private.v2_community_pair_revisions)<>1
 OR (SELECT count(*) FROM allin_private.v2_community_action_receipts)<>2
 THEN RAISE EXCEPTION 'Restored Community relationship graph incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM allin_private.v2_community_pair_revisions WHERE lower_user_id>=upper_user_id)
 OR EXISTS(SELECT 1 FROM allin_private.v2_community_follows f
 LEFT JOIN public.v2_profiles a ON a.user_id=f.follower_id
 LEFT JOIN public.v2_profiles b ON b.user_id=f.followed_id
 WHERE a.user_id IS NULL OR b.user_id IS NULL)
 THEN RAISE EXCEPTION 'Community restored owner identity invalid'; END IF;
 IF (SELECT profile_visibility FROM allin_private.v2_community_visibility
 WHERE user_id='a7171717-7171-4717-8717-717171717171')<>'private'
 THEN RAISE EXCEPTION 'Community restored private-by-default athlete public'; END IF;
END $check$;
SQL
docker exec "$db" rm -f /tmp/all12-community.dump
echo 'PASS ALL-12: five private Community relationship tables two-owner logical restore'
