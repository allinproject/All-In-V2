#!/usr/bin/env bash
# ALL-12 disposable-only populated EventHub recovery rehearsal. No hosted DB.
set -euo pipefail
test "${CI:-}" = 1
db="${1:?local Supabase DB container required}"
test "$db" = "$(docker ps --filter name=supabase_db_ --format '{{.ID}}' | head -n 1)"
sql() { docker exec -i "$db" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1; }
sql <<'SQL'
DO $gate$
BEGIN
 IF to_regclass('public.v2_events') IS NULL
 OR to_regclass('public.v2_event_groups') IS NULL
 OR to_regclass('public.v2_event_url_aliases') IS NULL
 OR to_regclass('public.v2_event_group_memberships') IS NULL
 OR to_regclass('public.v2_event_participations') IS NULL
 OR to_regclass('allin_private.v2_event_group_actions') IS NULL
 THEN RAISE EXCEPTION 'EventHub recovery graph missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_events)
 OR EXISTS(SELECT 1 FROM public.v2_event_groups)
 OR EXISTS(SELECT 1 FROM public.v2_event_url_aliases)
 OR EXISTS(SELECT 1 FROM public.v2_event_group_memberships)
 OR EXISTS(SELECT 1 FROM public.v2_event_participations)
 OR EXISTS(SELECT 1 FROM allin_private.v2_event_group_actions)
 THEN RAISE EXCEPTION 'EventHub restore requires empty disposable candidate graph'; END IF;
END $gate$;
INSERT INTO auth.users(id) VALUES
 ('a6161616-6161-4616-8616-616161616161'),
 ('b6161616-6161-4616-8616-616161616161');
INSERT INTO public.v2_events(id,name,sport,event_kind,start_local_date,event_timezone)
VALUES ('a6262626-6262-4626-8626-626262626262','Synthetic Trail Event','running','ultra','2027-04-10','America/Chicago');
INSERT INTO public.v2_event_url_aliases(id,event_id,canonical_url,evidence_kind)
VALUES ('a6363636-6363-4636-8636-636363636363','a6262626-6262-4626-8626-626262626262',
        'https://example.org/all12-eventhub-synthetic','submitted');
INSERT INTO public.v2_event_groups(id,event_id,state)
VALUES ('a6464646-6464-4646-8646-646464646464','a6262626-6262-4626-8626-626262626262','active');
INSERT INTO public.v2_event_group_memberships(user_id,event_id,group_id,state,joined_at,version)
VALUES ('a6161616-6161-4616-8616-616161616161','a6262626-6262-4626-8626-626262626262','a6464646-6464-4646-8646-646464646464','joined',now(),2),
 ('b6161616-6161-4616-8616-616161616161','a6262626-6262-4626-8626-626262626262','a6464646-6464-4646-8646-646464646464','joined',now(),2);
INSERT INTO public.v2_event_participations(user_id,event_id,state,source_kind)
VALUES ('a6161616-6161-4616-8616-616161616161','a6262626-6262-4626-8626-626262626262','registered','athlete_confirmed'),
 ('b6161616-6161-4616-8616-616161616161','a6262626-6262-4626-8626-626262626262','interested','athlete_confirmed');
INSERT INTO allin_private.v2_event_group_actions(
 user_id,session_id,action_id,event_id,group_id,reviewed_alias_id,action_kind,expected_version,result_version)
VALUES
 ('a6161616-6161-4616-8616-616161616161','a6565656-6565-4656-8656-656565656565','a6666666-6666-4666-8666-666666666666',
 'a6262626-6262-4626-8626-626262626262','a6464646-6464-4646-8646-646464646464','a6363636-6363-4636-8636-636363636363','join',1,2),
 ('b6161616-6161-4616-8616-616161616161','b6565656-6565-4656-8656-656565656565','b6666666-6666-4666-8666-666666666666',
 'a6262626-6262-4626-8626-626262626262','a6464646-6464-4646-8646-646464646464','a6363636-6363-4636-8636-636363636363','join',1,2);
SQL

manifest() {
sql <<'SQL'
SELECT label||'|'||n||'|'||digest FROM (
 SELECT 'events' label,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),'')) digest FROM public.v2_events t
 UNION ALL SELECT 'aliases',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),'')) FROM public.v2_event_url_aliases t
 UNION ALL SELECT 'groups',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),'')) FROM public.v2_event_groups t
 UNION ALL SELECT 'memberships',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY user_id,group_id),'')) FROM public.v2_event_group_memberships t
 UNION ALL SELECT 'participations',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY user_id,event_id),'')) FROM public.v2_event_participations t
 UNION ALL SELECT 'actions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY user_id,action_id),'')) FROM allin_private.v2_event_group_actions t
) s ORDER BY label;
SQL
}
before="$(manifest)"
test "$(printf '%s\n' "$before" | wc -l | tr -d ' ')" = 6
docker exec "$db" pg_dump -U postgres -d postgres -Fc --data-only \
 -t public.v2_events -t public.v2_event_url_aliases \
 -t public.v2_event_groups -t public.v2_event_group_memberships \
 -t public.v2_event_participations -t allin_private.v2_event_group_actions \
 -f /tmp/all12-eventhub.dump
# Canonical Event provenance intentionally denies DELETE. Only on the strictly
# identified disposable DB, bypass that one trigger inside a transaction to
# simulate total data loss; reenable atomically before pg_restore. Never hosted.
sql <<'SQL'
BEGIN;
ALTER TABLE public.v2_events DISABLE TRIGGER v2_event_version_guard;
DELETE FROM allin_private.v2_event_group_actions;
DELETE FROM public.v2_event_participations;
DELETE FROM public.v2_event_group_memberships;
DELETE FROM public.v2_event_url_aliases;
DELETE FROM public.v2_event_groups;
DELETE FROM public.v2_events;
ALTER TABLE public.v2_events ENABLE TRIGGER v2_event_version_guard;
COMMIT;
DO $guard$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM pg_trigger
 WHERE tgrelid='public.v2_events'::regclass
 AND tgname='v2_event_version_guard' AND tgenabled='O'
 ) THEN RAISE EXCEPTION 'Event provenance guard not reenabled after loss simulation'; END IF;
END $guard$;
SQL
docker exec "$db" pg_restore -U postgres -d postgres --data-only --exit-on-error /tmp/all12-eventhub.dump
after="$(manifest)"
test "$before" = "$after" || { diff -u <(echo "$before") <(echo "$after"); exit 1; }
sql <<'SQL'
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.v2_events)<>1
 OR (SELECT count(*) FROM public.v2_event_group_memberships)<>2
 OR (SELECT count(*) FROM public.v2_event_participations)<>2
 OR (SELECT count(*) FROM allin_private.v2_event_group_actions)<>2
 THEN RAISE EXCEPTION 'EventHub restore missing graph records'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_event_group_memberships m
 JOIN public.v2_event_groups g ON g.id=m.group_id WHERE g.event_id<>m.event_id)
 THEN RAISE EXCEPTION 'EventHub restored membership mislinked'; END IF;
 IF EXISTS(SELECT 1 FROM allin_private.v2_event_group_actions a
 LEFT JOIN public.v2_event_group_memberships m
 ON m.user_id=a.user_id AND m.group_id=a.group_id AND m.event_id=a.event_id
 WHERE m.user_id IS NULL OR m.version<>a.result_version)
 THEN RAISE EXCEPTION 'EventHub action receipt owner/version mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.v2_event_participations WHERE result_verified)
 THEN RAISE EXCEPTION 'Synthetic EventHub membership became verified race result'; END IF;
END $verify$;
SQL
docker exec "$db" rm -f /tmp/all12-eventhub.dump
echo 'PASS ALL-12: six-table EventHub two-owner populated restore with full-row checks'
