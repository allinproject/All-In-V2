#!/usr/bin/env bash
# ALL-12 disposable-only Training plan graph populated backup/delete/restore.
set -euo pipefail
test "${CI:-}" = "1"
db="${1:?local Supabase DB container required}"
[[ "$db" == "$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)" ]] || exit 1
psql_local() { docker exec -i "$db" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1; }
psql_local <<'SQL'
DO $gate$
BEGIN
 IF to_regclass('public.v2_training_plans') IS NULL OR
    to_regclass('public.v2_training_plan_revisions') IS NULL OR
    to_regclass('public.v2_training_session_slots') IS NULL OR
    to_regclass('public.v2_training_revision_days') IS NULL OR
    to_regclass('public.v2_training_revision_sessions') IS NULL
 THEN RAISE EXCEPTION 'Training plan candidate graph missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_training_plans)
 THEN RAISE EXCEPTION 'Requires empty disposable Training plan graph'; END IF;
END $gate$;
INSERT INTO auth.users(id,raw_user_meta_data) VALUES
 ('a5151515-1515-4515-8515-151515151515','{"all12":"plan-a"}'),
 ('b5151515-1515-4515-8515-151515151515','{"all12":"plan-b"}');
INSERT INTO public.v2_training_plans(id,user_id,plan_kind)
VALUES ('a5252525-2525-4525-8525-252525252525','a5151515-1515-4515-8515-151515151515','race'),
       ('b5252525-2525-4525-8525-252525252525','b5151515-1515-4515-8515-151515151515','general');
INSERT INTO public.v2_training_plan_revisions(id,plan_id,user_id,revision_number,source_kind)
VALUES ('a5353535-3535-4535-8535-353535353535','a5252525-2525-4525-8525-252525252525','a5151515-1515-4515-8515-151515151515',1,'athlete_authored'),
       ('b5353535-3535-4535-8535-353535353535','b5252525-2525-4525-8525-252525252525','b5151515-1515-4515-8515-151515151515',1,'coach_proposal');
INSERT INTO public.v2_training_session_slots(id,plan_id,user_id,slot_key)
VALUES ('a5454545-4545-4545-8545-454545454545','a5252525-2525-4525-8525-252525252525','a5151515-1515-4515-8515-151515151515','long-run'),
       ('b5454545-4545-4545-8545-454545454545','b5252525-2525-4525-8525-252525252525','b5151515-1515-4515-8515-151515151515','easy-day');
INSERT INTO public.v2_training_revision_days(id,plan_revision_id,plan_id,user_id,athlete_local_date,timezone,day_state,sort_order)
VALUES ('a5555555-5555-4555-8555-555555555555','a5353535-3535-4535-8535-353535353535','a5252525-2525-4525-8525-252525252525','a5151515-1515-4515-8515-151515151515','2026-11-12','America/Chicago','planned',0),
       ('b5555555-5555-4555-8555-555555555555','b5353535-3535-4535-8535-353535353535','b5252525-2525-4525-8525-252525252525','b5151515-1515-4515-8515-151515151515','2026-11-12','America/Chicago','planned',0);
INSERT INTO public.v2_training_revision_sessions(id,plan_revision_id,session_slot_id,plan_id,user_id,athlete_local_date,timezone,sport,session_kind,purpose,priority,intensity,intent_schema_version,intent,sort_order)
VALUES ('a5656565-5656-4565-8565-565656565656','a5353535-3535-4535-8535-353535353535','a5454545-4545-4545-8545-454545454545','a5252525-2525-4525-8525-252525252525','a5151515-1515-4515-8515-151515151515','2026-11-12','America/Chicago','running','long_run','Recovery fixture A','key','easy','session-intent-v1','{}',0),
       ('b5656565-5656-4565-8565-565656565656','b5353535-3535-4535-8535-353535353535','b5454545-4545-4545-8545-454545454545','b5252525-2525-4525-8525-252525252525','b5151515-1515-4515-8515-151515151515','2026-11-12','America/Chicago','cycling','easy_ride','Recovery fixture B','supporting','easy','session-intent-v1','{}',0);
SQL
manifest_sql="SELECT tbl||E'\\t'||owner||E'\\t'||n||E'\\t'||digest FROM (
$(for table in v2_training_plans v2_training_plan_revisions v2_training_session_slots v2_training_revision_days v2_training_revision_sessions; do
 printf "SELECT '%s' tbl,user_id::text owner,count(*) n,md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id)) digest FROM public.%s t GROUP BY user_id UNION ALL\n" "$table" "$table"
done | sed '$s/ UNION ALL$//')
) s ORDER BY tbl,owner;"
manifest() { printf '%s\n' "$manifest_sql" | psql_local; }
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 10
docker exec "$db" pg_dump -U postgres -d postgres -Fc --data-only \
 -t public.v2_training_plans -t public.v2_training_plan_revisions \
 -t public.v2_training_session_slots -t public.v2_training_revision_days \
 -t public.v2_training_revision_sessions -f /tmp/all12-training-plans.dump
psql_local <<'SQL'
DELETE FROM public.v2_training_revision_sessions;
DELETE FROM public.v2_training_revision_days;
DELETE FROM public.v2_training_session_slots;
DELETE FROM public.v2_training_plan_revisions;
DELETE FROM public.v2_training_plans;
SQL
docker exec "$db" pg_restore -U postgres -d postgres --data-only --exit-on-error /tmp/all12-training-plans.dump
after="$(manifest)"
test "$before" = "$after" || { diff -u <(echo "$before") <(echo "$after"); exit 1; }
psql_local <<'SQL'
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_training_revision_sessions s
 JOIN public.v2_training_plan_revisions r ON r.id=s.plan_revision_id
 JOIN public.v2_training_session_slots t ON t.id=s.session_slot_id
 WHERE s.user_id<>r.user_id OR s.user_id<>t.user_id OR s.plan_id<>r.plan_id)
 THEN RAISE EXCEPTION 'Cross-owner restored Training plan graph'; END IF;
END $verify$;
SQL
docker exec "$db" rm -f /tmp/all12-training-plans.dump
echo 'PASS ALL-12: five-table two-owner Training plan graph full-row restore and relationship integrity'
