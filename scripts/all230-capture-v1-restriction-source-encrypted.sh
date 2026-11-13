#!/usr/bin/env bash
# ALL-230: independent operator-only encrypted V1 source-scope snapshot.
# This is a restricted SOURCE subset, not proof of complete V1 history.
# Run only from a trusted Linux/WSL workstation with PostgreSQL 17 clients
# and age, with an offline-owned age recipient public key.
# NEVER run in GitHub Actions, copy plaintext to disk, or enter credentials in chat.
set -euo pipefail
umask 077
: "${CI:=}"
: "${GITHUB_ACTIONS:=}"
[[ "${CI}" != "1" && "${CI}" != "true" && "${GITHUB_ACTIONS}" != "true" ]] ||
 { echo 'Refusing CI source export' >&2; exit 1; }
[[ "${ALL230_V1_CAPTURE_APPROVED:-}" == "YES" ]] ||
 { echo 'Independent V1 source capture approval required' >&2; exit 1; }
[[ "${ALL230_V1_SOURCE_PROJECT_REF:-}" == "impulecgsgaruvniuttc" ]] ||
 { echo 'Wrong V1 source project' >&2; exit 1; }
[[ "${ALL230_V1_SECURE_CUSTODY_APPROVED:-}" == "YES" ]] ||
 { echo 'Approved encrypted offline custody required' >&2; exit 1; }
[[ "${PGDATABASE:-}" == "postgres" && "${PGSSLMODE:-}" == "verify-full" &&
   -n "${PGPASSWORD:-}" ]] ||
 { echo 'Expected read-only V1 PostgreSQL TLS credentials unavailable' >&2; exit 1; }
if [[ "${PGHOST:-}" == "db.impulecgsgaruvniuttc.supabase.co" ]]; then
 [[ "${PGUSER:-}" == "postgres" ]] ||
  { echo 'Wrong V1 direct connection role' >&2; exit 1; }
elif [[ "${PGHOST:-}" =~ ^[a-z0-9.-]+\.pooler\.supabase\.com$ ]]; then
 [[ "${PGUSER:-}" == "postgres.impulecgsgaruvniuttc" ]] ||
  { echo 'Wrong V1 pooler role' >&2; exit 1; }
else
 echo 'Refusing unrecognized V1 endpoint' >&2; exit 1
fi
[[ "${ALL230_V1_AGE_RECIPIENT:-}" =~ ^age1[a-z0-9]{50,90}$ ]] ||
 { echo 'Valid offline age public recipient required' >&2; exit 1; }
[[ -n "${ALL230_V1_ARCHIVE_DIRECTORY:-}" &&
  -d "${ALL230_V1_ARCHIVE_DIRECTORY}" &&
  ! -L "${ALL230_V1_ARCHIVE_DIRECTORY}" ]] ||
 { echo 'Pre-existing, non-symlink encrypted archive directory required' >&2; exit 1; }
for command in pg_dump age sha256sum stat node openssl; do
 command -v "$command" >/dev/null ||
 { echo 'Required local backup command unavailable' >&2; exit 1; }
done
dir="$(cd -- "${ALL230_V1_ARCHIVE_DIRECTORY}" && pwd -P)"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
case "$dir/" in "$root/"*) echo 'Refusing backups under the repository' >&2; exit 1;; esac
[[ "$dir" != "/" ]] || { echo 'Refusing root destination' >&2; exit 1; }
[[ "$(stat -c '%a' "$dir")" == "700" ]] ||
 { echo 'Archive directory must have private 0700 permissions' >&2; exit 1; }

# EXACT known candidate source inventory, not a claim that these are ALL
# historical/import sources. Omit auth/service secrets and Supabase internals.
tables=(
 public.allin_training
 public.allin_training_plan_versions
 public.allin_training_sessions
 public.allin_workout_user_overrides
 public.allin_workout_plan_links
 public.allin_coach_learnings
 public.allin_coach_thread_facts
 public.allin_coach_thread_state
 public.allin_coaching_records
 public.allin_workout_sync_sources
 public.allin_backup_restore_drills
)
argv=(--format=custom --data-only --no-owner --no-acl)
for table in "${tables[@]}"; do argv+=("--table=$table"); done
prefix="all230-v1-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8)"
encrypted="$dir/$prefix.dump.age"
receipt="$dir/$prefix.capture.json"
temp="$encrypted.part"
[[ ! -e "$encrypted" && ! -e "$receipt" && ! -e "$temp" ]] ||
 { echo 'Refusing archive overwrite' >&2; exit 1; }
success=NO
cleanup() {
 rm -f -- "$temp" "$receipt.part"
 if [[ "$success" != YES ]]; then rm -f -- "$encrypted" "$receipt"; fi
}
trap cleanup EXIT
start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# pg_dump produces plaintext only in the PRIVATE PIPE; age writes ciphertext
# directly to a 0600 file. pipefail guarantees partial files are deleted.
(
 set -C
 PGOPTIONS='-c default_transaction_read_only=on' pg_dump "${argv[@]}" |
   age -r "$ALL230_V1_AGE_RECIPIENT" > "$temp"
)
[[ -s "$temp" ]] || { echo 'No encrypted output' >&2; exit 1; }
digest="$(sha256sum "$temp" | cut -d ' ' -f 1)"
[[ "$digest" =~ ^[a-f0-9]{64}$ ]] ||
 { echo 'Encrypted archive digest invalid' >&2; exit 1; }
end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ln -- "$temp" "$encrypted"
rm -f -- "$temp"
# Metadata is deliberately NOT a trusted acquisition / import manifest.
# It cannot establish a precise snapshot cutoff or complete V1 source scope.
(
 set -C
 printf '{"sourceProjectRef":"impulecgsgaruvniuttc","captureMethod":"restricted_v1_logical_pg_dump_age","ciphertextSha256":"%s","captureStartedUtc":"%s","captureCompletedUtc":"%s","tableCount":11,"scopeExhaustive":false,"snapshotCutoffPreciselyProven":false,"independentSourceCustodyAccepted":false,"importHistoryComplete":false,"ownerLimitationMapped":false,"initialCertificationAuthorized":false}\n' \
 "$digest" "$start" "$end" > "$receipt.part"
)
ln -- "$receipt.part" "$receipt"
rm -f -- "$receipt.part"
success=YES
trap - EXIT
# Printing artifact paths on a private operator terminal is safe; never log
# them to CI or transmit the encrypted archive to GitHub.
printf 'ENCRYPTED V1 SOURCE SUBSET CAPTURED; release NOT authorized\n'
printf 'Private ciphertext: %s\nPrivate receipt: %s\n' "$encrypted" "$receipt"
