#!/usr/bin/env bash
# ALL-230/ALL-12: Original V1 FK restore on a disposable, disconnected target.
# Never creates Auth users, never contacts live provider, never exports data.
set -euo pipefail
TARGET=all230-v1-restore-20261113
SQL=supabase/tests/all230_v1_original_17_fk_offline_candidate.sql
command -v docker >/dev/null || { echo 'BLOCKED: Docker missing'; exit 2; }
NETWORK=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$TARGET")
PORTS=$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$TARGET")
TMPFS=$(docker inspect -f '{{json .HostConfig.Tmpfs}}' "$TARGET")
[[ "$NETWORK" == none && ( "$PORTS" == null || "$PORTS" == '{}' ) && "$TMPFS" == *'/var/lib/postgresql/data'* ]] || { echo 'BLOCKED: restore target not sufficiently isolated'; exit 2; }
[[ -f "$SQL" ]] || { echo 'BLOCKED: pinned SQL missing; run from repository root'; exit 2; }
sql() { docker exec "$TARGET" psql -X -U postgres -d postgres -Atqc "$1"; }
PRE=$(sql "SELECT (to_regclass('auth.users') IS NOT NULL)::int || '|' || (to_regclass('auth.identities') IS NOT NULL)::int || '|' || (to_regclass('auth.sessions') IS NOT NULL)::int || '|' || (to_regclass('public.allin_profile_goals') IS NOT NULL)::int;")
[[ "$PRE" == '1|1|1|1' ]] || { echo 'BLOCKED: real Auth and profile goals schema not restored'; exit 2; }
OWNER=$(sql "SELECT (SELECT count(*) FROM auth.users)::text || '|' || (SELECT count(*) FROM auth.identities)::text || '|' || (SELECT count(*) FROM public.allin_training)::text || '|' || (SELECT count(*) FROM public.allin_training t JOIN auth.users u ON t.user_id=u.id)::text;")
[[ "$OWNER" == '1|1|1|1' ]] || { echo 'BLOCKED: original Auth/Training owner graph missing or drifted'; exit 2; }
[[ "$(printenv ALL230_GENUINE_AUTH_SOURCE_REVIEW_APPROVED 2>/dev/null || true)" == YES ]] || { echo 'BLOCKED: independent original Auth evidence approval required'; exit 2; }
FKCOUNT=$(sql "SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.contype='f' AND t.relname IN ('allin_backup_restore_drills','allin_coach_learnings','allin_coach_thread_facts','allin_coach_thread_state','allin_coaching_records','allin_training','allin_training_plan_versions','allin_training_sessions','allin_workout_plan_links','allin_workout_sync_sources','allin_workout_user_overrides');")
if [[ "$FKCOUNT" == 0 ]]; then
 [[ "$(printenv ALL230_OFFLINE_FK_INSTALL_APPROVED 2>/dev/null || true)" == YES ]] || { echo 'BLOCKED: explicit offline FK install approval required'; exit 2; }
 docker exec -i "$TARGET" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$SQL"
elif [[ "$FKCOUNT" != 17 ]]; then
 echo 'BLOCKED: partial original FK state; no modification';exit 2
fi
VALID=$(sql "SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.contype='f' AND c.convalidated AND t.relname IN ('allin_backup_restore_drills','allin_coach_learnings','allin_coach_thread_facts','allin_coach_thread_state','allin_coaching_records','allin_training','allin_training_plan_versions','allin_training_sessions','allin_workout_plan_links','allin_workout_sync_sources','allin_workout_user_overrides');")
DIGEST=$(sql "SELECT md5(string_agg(c.conrelid::regclass::text || '|' || c.conname || '|' || pg_get_constraintdef(c.oid,true), '\n' ORDER BY c.conrelid::regclass::text,c.conname)) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.contype='f' AND t.relname IN ('allin_backup_restore_drills','allin_coach_learnings','allin_coach_thread_facts','allin_coach_thread_state','allin_coaching_records','allin_training','allin_training_plan_versions','allin_training_sessions','allin_workout_plan_links','allin_workout_sync_sources','allin_workout_user_overrides');")
[[ "$VALID" == 17 && "$DIGEST" == cb8a4806420ab2b409bef8736678ff59 ]] || { echo 'FAIL: original FK count/definition digest differs';exit 1; }
echo 'PASS: 17 original V1 FK constraints restored, validated and fingerprinted in offline target'
echo 'NOTE: source authenticity, sign-in and hosted restore require separate evidence'
