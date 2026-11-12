#!/usr/bin/env bash
# ALL-12 indoor weekly Progress candidate: local populated restore only.
set -euo pipefail
test "${CI:-}" = "1"
db="${1:?local Supabase DB container required}"
test "$db" = "$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)"
sql() { docker exec -i "$db" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1; }
sql <<'SQL'
DO $gate$
BEGIN
 IF to_regclass('public.v2_indoor_weekly_challenges') IS NULL
 OR to_regclass('public.v2_indoor_weekly_attempts') IS NULL
 OR to_regclass('public.v2_indoor_weekly_leaderboard') IS NULL
 OR to_regclass('public.v2_indoor_weekly_achievements') IS NULL
 OR to_regclass('allin_private.v2_indoor_weekly_config') IS NULL
 THEN RAISE EXCEPTION 'Indoor Progress candidate incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_indoor_weekly_challenges)
 OR EXISTS(SELECT 1 FROM public.v2_indoor_weekly_attempts)
 OR EXISTS(SELECT 1 FROM public.v2_indoor_weekly_leaderboard)
 OR EXISTS(SELECT 1 FROM public.v2_indoor_weekly_achievements)
 THEN RAISE EXCEPTION 'Indoor Progress recovery requires empty disposable graph'; END IF;
 IF EXISTS(SELECT 1 FROM allin_private.v2_indoor_weekly_config
 WHERE generation_enabled OR publication_enabled OR finalization_enabled)
 THEN RAISE EXCEPTION 'Unsafe indoor competition configuration'; END IF;
END $gate$;
INSERT INTO auth.users(id) VALUES
 ('a8181818-8181-4818-8818-818181818181'),
 ('b8181818-8181-4818-8818-818181818181');
INSERT INTO public.v2_completed_activities(
 id,user_id,sport,activity_kind,athlete_local_date,timezone,capture_kind,status)
VALUES
 ('a8282828-8282-4828-8828-828282828282','a8181818-8181-4818-8818-818181818181',
 'cycling','competition','2026-11-09','America/Chicago','device_measured','completed'),
 ('b8282828-8282-4828-8828-828282828282','b8181818-8181-4818-8818-818181818181',
 'cycling','competition','2026-11-09','America/Chicago','device_measured','completed');
INSERT INTO public.v2_indoor_weekly_challenges(
 id,week_start,state,rules_version,generator_version,scoring_version,
 prescription_version,common_structure_id,workout_definition,scored_effort_definition,
 opens_at,closes_at,published_at,closed_at,finalized_at)
VALUES ('a8383838-8383-4838-8838-838383838383','2026-11-09','finalized',
 'all12-rules','all12-generator','challenge-score-v1','all12-prescription',
 'all12-common','{"synthetic":true}','{"synthetic":true}',
 '2026-11-09T00:00:00Z','2026-11-16T00:00:00Z',
 '2026-11-08T00:00:00Z','2026-11-16T00:01:00Z','2026-11-16T00:02:00Z');
INSERT INTO public.v2_indoor_weekly_attempts(
 id,challenge_id,user_id,completed_activity_id,frozen_prescription_version,
 frozen_prescription,frozen_baseline,verification_state,final_integrity_state,
 score,scoring_version,completed_at,verified_at)
VALUES
 ('a8484848-8484-4848-8848-848484848484','a8383838-8383-4838-8838-838383838383',
 'a8181818-8181-4818-8818-818181818181','a8282828-8282-4828-8828-828282828282',
 'all12-prescription','{"synthetic":true}','{"ftp":200}', 'verified','accepted',
 81.500,'challenge-score-v1','2026-11-10T02:00:00Z','2026-11-10T03:00:00Z'),
 ('b8484848-8484-4848-8848-848484848484','a8383838-8383-4838-8838-838383838383',
 'b8181818-8181-4818-8818-818181818181','b8282828-8282-4828-8828-828282828282',
 'all12-prescription','{"synthetic":true}','{"ftp":225}', 'verified','accepted',
 75.250,'challenge-score-v1','2026-11-10T04:00:00Z','2026-11-10T05:00:00Z');
INSERT INTO public.v2_indoor_weekly_leaderboard(
 challenge_id,user_id,best_attempt_id,best_score,live_rank,final_rank,finalized_at)
VALUES
 ('a8383838-8383-4838-8838-838383838383','a8181818-8181-4818-8818-818181818181',
 'a8484848-8484-4848-8848-848484848484',81.500,1,1,'2026-11-16T00:02:00Z'),
 ('a8383838-8383-4838-8838-838383838383','b8181818-8181-4818-8818-818181818181',
 'b8484848-8484-4848-8848-848484848484',75.250,2,2,'2026-11-16T00:02:00Z');
INSERT INTO public.v2_indoor_weekly_achievements(challenge_id,user_id,tier,final_rank)
VALUES
 ('a8383838-8383-4838-8838-838383838383','a8181818-8181-4818-8818-818181818181','champion',1),
 ('a8383838-8383-4838-8838-838383838383','b8181818-8181-4818-8818-818181818181','top_5',2);
SQL
manifest() {
sql <<'SQL'
SELECT label||'|'||n||'|'||digest FROM (
 SELECT 'challenges' label,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),'')) digest FROM public.v2_indoor_weekly_challenges t
 UNION ALL SELECT 'attempts',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),'')) FROM public.v2_indoor_weekly_attempts t
 UNION ALL SELECT 'leaderboard',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY challenge_id,user_id),'')) FROM public.v2_indoor_weekly_leaderboard t
 UNION ALL SELECT 'achievements',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY challenge_id,user_id),'')) FROM public.v2_indoor_weekly_achievements t
 UNION ALL SELECT 'config',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY singleton),'')) FROM allin_private.v2_indoor_weekly_config t
) s ORDER BY label;
SQL
}
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 5
docker exec "$db" pg_dump -U postgres -d postgres -Fc --data-only \
 -t public.v2_indoor_weekly_challenges -t public.v2_indoor_weekly_attempts \
 -t public.v2_indoor_weekly_leaderboard -t public.v2_indoor_weekly_achievements \
 -t allin_private.v2_indoor_weekly_config -f /tmp/all12-indoor-progress.dump
sql <<'SQL'
DELETE FROM public.v2_indoor_weekly_achievements;
DELETE FROM public.v2_indoor_weekly_leaderboard;
DELETE FROM public.v2_indoor_weekly_attempts;
DELETE FROM public.v2_indoor_weekly_challenges;
DELETE FROM allin_private.v2_indoor_weekly_config;
SQL
docker exec "$db" pg_restore -U postgres -d postgres --data-only --exit-on-error /tmp/all12-indoor-progress.dump
after="$(manifest)"
test "$before" = "$after" || { diff -u <(echo "$before") <(echo "$after"); exit 1; }
sql <<'SQL'
DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM allin_private.v2_indoor_weekly_config
 WHERE generation_enabled OR publication_enabled OR finalization_enabled)
 THEN RAISE EXCEPTION 'Restored Progress configuration unexpectedly enabled'; END IF;
 IF (SELECT count(*) FROM public.v2_indoor_weekly_attempts)<>2
 OR (SELECT count(*) FROM public.v2_indoor_weekly_achievements)<>2
 OR EXISTS(SELECT 1 FROM public.v2_indoor_weekly_leaderboard l
 JOIN public.v2_indoor_weekly_attempts a ON a.id=l.best_attempt_id
 WHERE a.user_id<>l.user_id OR a.challenge_id<>l.challenge_id OR a.score<>l.best_score)
 THEN RAISE EXCEPTION 'Restored indoor Progress score/owner relationships invalid'; END IF;
END $check$;
SQL
docker exec "$db" rm -f /tmp/all12-indoor-progress.dump
echo 'PASS ALL-12: five-table populated indoor Progress restore and disabled config'
