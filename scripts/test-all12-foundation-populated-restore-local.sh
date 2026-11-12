#!/usr/bin/env bash
# ALL-12: disposable-only populated foundation data restore. Never run on hosted DB.
set -euo pipefail
test "${CI:-}" = "1"
db="${1:?local Supabase db container required}"
test "$db" = "$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)"
owner="e1212121-2121-4121-8121-212121212121"
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $gate$
BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_profiles) OR EXISTS(SELECT 1 FROM public.v2_profile_settings)
 OR EXISTS(SELECT 1 FROM public.v2_onboarding_progress)
 OR EXISTS(SELECT 1 FROM allin_private.v2_health_considerations)
 OR EXISTS(SELECT 1 FROM allin_private.v2_profile_settings_actions)
 OR EXISTS(SELECT 1 FROM allin_private.v2_onboarding_actions)
 OR EXISTS(SELECT 1 FROM allin_private.v2_account_deletion_requests)
 THEN RAISE EXCEPTION 'ALL-12 requires empty isolated foundation tables'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id='e1212121-2121-4121-8121-212121212121')
 THEN RAISE EXCEPTION 'ALL-12 fixture owner already exists'; END IF;
END $gate$;
INSERT INTO auth.users(id) VALUES('e1212121-2121-4121-8121-212121212121');
INSERT INTO public.v2_profiles(user_id,display_name) VALUES('e1212121-2121-4121-8121-212121212121','Recovery athlete')
ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name;
INSERT INTO public.v2_profile_settings(user_id,settings) VALUES('e1212121-2121-4121-8121-212121212121','{"units":"metric"}')
ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings;
INSERT INTO public.v2_onboarding_progress(user_id,completed_steps)
VALUES('e1212121-2121-4121-8121-212121212121',ARRAY['focus']::text[])
ON CONFLICT(user_id) DO UPDATE SET completed_steps=excluded.completed_steps;
INSERT INTO allin_private.v2_health_considerations(user_id,conditions,coach_opt_in)
VALUES('e1212121-2121-4121-8121-212121212121','["synthetic"]',false);
INSERT INTO allin_private.v2_profile_settings_actions(user_id,client_action_id,section,payload,result_version)
VALUES('e1212121-2121-4121-8121-212121212121','all12-settings','preferences','{"units":"metric"}',1);
INSERT INTO allin_private.v2_onboarding_actions(user_id,client_action_id,step,action,result_version)
VALUES('e1212121-2121-4121-8121-212121212121','all12-onboard','focus','complete',1);
INSERT INTO allin_private.v2_account_deletion_requests(user_id,status)
VALUES('e1212121-2121-4121-8121-212121212121','requested');
SQL
# Per-table, per-owner complete JSONB row digest. No user data printed.
read -r -d '' sql <<'SQL' || true
SELECT domain||'|'||n||'|'||digest FROM (
 SELECT 'profile' domain,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY user_id),'')) digest FROM public.v2_profiles t WHERE user_id='e1212121-2121-4121-8121-212121212121'
 UNION ALL SELECT 'settings',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY user_id),'')) FROM public.v2_profile_settings t WHERE user_id='e1212121-2121-4121-8121-212121212121'
 UNION ALL SELECT 'onboarding',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY user_id),'')) FROM public.v2_onboarding_progress t WHERE user_id='e1212121-2121-4121-8121-212121212121'
 UNION ALL SELECT 'health',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY user_id),'')) FROM allin_private.v2_health_considerations t WHERE user_id='e1212121-2121-4121-8121-212121212121'
 UNION ALL SELECT 'settings_actions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY client_action_id),'')) FROM allin_private.v2_profile_settings_actions t WHERE user_id='e1212121-2121-4121-8121-212121212121'
 UNION ALL SELECT 'onboarding_actions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY client_action_id),'')) FROM allin_private.v2_onboarding_actions t WHERE user_id='e1212121-2121-4121-8121-212121212121'
 UNION ALL SELECT 'deletion_request',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY request_id),'')) FROM allin_private.v2_account_deletion_requests t WHERE user_id='e1212121-2121-4121-8121-212121212121'
) q ORDER BY domain;
SQL
manifest(){ docker exec -i "$db" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 <<<"$sql"; }
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 7
test "$(printf '%s\n' "$before" | grep -c '|1|')" = 7
docker exec "$db" pg_dump -U postgres -d postgres -Fc --data-only \
 -t public.v2_profiles -t public.v2_profile_settings -t public.v2_onboarding_progress \
 -t allin_private.v2_health_considerations -t allin_private.v2_profile_settings_actions \
 -t allin_private.v2_onboarding_actions -t allin_private.v2_account_deletion_requests \
 -f /tmp/all12-foundation.dump
docker exec -i "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM allin_private.v2_account_deletion_requests WHERE user_id='e1212121-2121-4121-8121-212121212121';
DELETE FROM allin_private.v2_onboarding_actions WHERE user_id='e1212121-2121-4121-8121-212121212121';
DELETE FROM allin_private.v2_profile_settings_actions WHERE user_id='e1212121-2121-4121-8121-212121212121';
DELETE FROM allin_private.v2_health_considerations WHERE user_id='e1212121-2121-4121-8121-212121212121';
DELETE FROM public.v2_onboarding_progress WHERE user_id='e1212121-2121-4121-8121-212121212121';
DELETE FROM public.v2_profile_settings WHERE user_id='e1212121-2121-4121-8121-212121212121';
DELETE FROM public.v2_profiles WHERE user_id='e1212121-2121-4121-8121-212121212121';
SQL
docker exec "$db" pg_restore -U postgres -d postgres --data-only --exit-on-error /tmp/all12-foundation.dump
after="$(manifest)"
test "$before" = "$after" || { echo 'FAIL ALL-12 foundation row digest mismatch'; exit 1; }
docker exec "$db" rm -f /tmp/all12-foundation.dump
echo 'PASS ALL-12: seven populated foundation owner tables restored with exact row digests'
