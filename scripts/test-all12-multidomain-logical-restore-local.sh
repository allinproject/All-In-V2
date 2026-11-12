#!/usr/bin/env bash
# ALL-12: local-only multi-domain data recovery; no remote credentials.
set -euo pipefail
test "${CI:-}" = "1"
db="${1:?local Supabase postgres Docker container required}"
[[ "$db" == "$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)" ]] || { echo 'Refusing non-local Supabase DB'; exit 1; }
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $gate$
BEGIN
 IF to_regclass('public.v2_coach_messages') IS NULL
 OR to_regclass('public.v2_completed_activities') IS NULL
 OR to_regclass('public.v2_training_session_instances') IS NULL
 OR to_regclass('public.v2_activity_sources') IS NULL
 THEN RAISE EXCEPTION 'ALL-12 required canonical candidates absent'; END IF;
END $gate$;
-- Refuse to dump unrelated fixture records; isolated test DB required.
DO $empty$
BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_training_session_instances)
 OR EXISTS(SELECT 1 FROM public.v2_completed_activities)
 OR EXISTS(SELECT 1 FROM public.v2_activity_sources)
 OR EXISTS(SELECT 1 FROM public.v2_coach_threads)
 OR EXISTS(SELECT 1 FROM public.v2_coach_messages)
 THEN RAISE EXCEPTION 'ALL-12 requires isolated empty candidate tables'; END IF;
END $empty$;
INSERT INTO auth.users(id,raw_user_meta_data)
VALUES ('a1212121-2121-4121-8121-212121212121','{"display_name":"Recovery A"}'),
       ('b1212121-2121-4121-8121-212121212121','{"display_name":"Recovery B"}');
INSERT INTO public.v2_training_session_instances(id,user_id,status,source_kind,athlete_local_date,timezone)
VALUES ('a2222222-2222-4222-8222-222222222222','a1212121-2121-4121-8121-212121212121','active','phone','2026-11-12','America/Chicago');
INSERT INTO public.v2_completed_activities(id,user_id,sport,activity_kind,athlete_local_date,timezone,capture_kind,status,training_session_instance_id)
VALUES ('a3333333-3333-4333-8333-333333333333','a1212121-2121-4121-8121-212121212121','running','workout','2026-11-12','America/Chicago','device_measured','completed','a2222222-2222-4222-8222-222222222222'),
       ('b3333333-3333-4333-8333-333333333333','b1212121-2121-4121-8121-212121212121','cycling','free_activity','2026-11-12','America/Chicago','manual_only','needs_review',NULL);
INSERT INTO public.v2_activity_sources(id,activity_id,user_id,provider,source_kind,source_record_id,quality)
VALUES ('a4444444-4444-4444-8444-444444444444','a3333333-3333-4333-8333-333333333333','a1212121-2121-4121-8121-212121212121','apple_watch','workout_record','all12-recovery-watch-a','trusted');
INSERT INTO public.v2_coach_threads(id,user_id)
VALUES ('a5555555-5555-4555-8555-555555555555','a1212121-2121-4121-8121-212121212121'),
       ('b5555555-5555-4555-8555-555555555555','b1212121-2121-4121-8121-212121212121');
INSERT INTO public.v2_coach_messages(id,user_id,thread_id,role,content,client_action_id)
VALUES ('a6666666-6666-4666-8666-666666666666','a1212121-2121-4121-8121-212121212121','a5555555-5555-4555-8555-555555555555','user','Recovery run A','a7777777-7777-4777-8777-777777777777'),
       ('b6666666-6666-4666-8666-666666666666','b1212121-2121-4121-8121-212121212121','b5555555-5555-4555-8555-555555555555','user','Recovery ride B','b7777777-7777-4777-8777-777777777777');

SQL
# Collect manifests outside the DB; comparison survives separate psql sessions.
# These fixture tables must be exclusively owned by this disposable test.
manifest_sql=$(cat <<'SQL'
-- Each record's entire JSON representation is hashed in stable primary-key order.
-- Include row counts and per-owner breakdown to detect missing/foreign records.
SELECT domain || E'\\t' || owner || E'\\t' || n || E'\\t' || digest
FROM (
 SELECT 'training' domain,user_id::text owner,count(*) n,
        md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id)) digest
 FROM public.v2_training_session_instances t GROUP BY user_id
 UNION ALL
 SELECT 'activity',user_id::text,count(*),
        md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id))
 FROM public.v2_completed_activities t GROUP BY user_id
 UNION ALL
 SELECT 'source',user_id::text,count(*),
        md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id))
 FROM public.v2_activity_sources t GROUP BY user_id
 UNION ALL
 SELECT 'coach_thread',user_id::text,count(*),
        md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id))
 FROM public.v2_coach_threads t GROUP BY user_id
 UNION ALL
 SELECT 'coach_message',user_id::text,count(*),
        md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id))
 FROM public.v2_coach_messages t GROUP BY user_id
) x ORDER BY domain,owner;
SQL
)
manifest() { docker exec -i "$db" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 <<<"$manifest_sql"; }
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 8 || { echo 'Unexpected pre-backup domain/owner coverage'; exit 1; }
docker exec "$db" pg_dump -U postgres -d postgres -Fc --data-only \
  -t public.v2_training_session_instances -t public.v2_completed_activities \
  -t public.v2_activity_sources -t public.v2_coach_threads \
  -t public.v2_coach_messages -f /tmp/all12-multidomain.dump
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.v2_coach_messages WHERE user_id IN ('a1212121-2121-4121-8121-212121212121','b1212121-2121-4121-8121-212121212121');
DELETE FROM public.v2_coach_threads WHERE user_id IN ('a1212121-2121-4121-8121-212121212121','b1212121-2121-4121-8121-212121212121');
DELETE FROM public.v2_activity_sources WHERE user_id='a1212121-2121-4121-8121-212121212121';
DELETE FROM public.v2_completed_activities WHERE user_id IN ('a1212121-2121-4121-8121-212121212121','b1212121-2121-4121-8121-212121212121');
DELETE FROM public.v2_training_session_instances WHERE user_id='a1212121-2121-4121-8121-212121212121';
SQL
docker exec "$db" pg_restore -U postgres -d postgres --data-only --exit-on-error /tmp/all12-multidomain.dump
after="$(manifest)"
if [[ "$before" != "$after" ]]; then
  echo 'FAIL ALL-12: pre/post restore row counts, owners or row digests differ' >&2
  diff -u <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  exit 1
fi
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.v2_completed_activities WHERE id IN ('a3333333-3333-4333-8333-333333333333','b3333333-3333-4333-8333-333333333333'))<>2
 OR (SELECT count(*) FROM public.v2_coach_messages WHERE id IN ('a6666666-6666-4666-8666-666666666666','b6666666-6666-4666-8666-666666666666'))<>2
 THEN RAISE EXCEPTION 'ALL-12 recovered owner records missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_activity_sources s JOIN public.v2_completed_activities a ON a.id=s.activity_id WHERE s.user_id<>a.user_id)
 THEN RAISE EXCEPTION 'ALL-12 recovered cross-owner source'; END IF;
END $verify$;
SQL
docker exec "$db" rm -f /tmp/all12-multidomain.dump
echo 'PASS ALL-12: deterministic per-owner counts and full-row digests match after local multi-domain pg_dump/pg_restore'
