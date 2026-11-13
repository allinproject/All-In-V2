#!/usr/bin/env bash
# ALL-230/ALL-12. Operator-only approved encrypted V1 source-domain capture.
# No provider attestation, complete Storage backup, or unified snapshot cutoff.
set -euo pipefail
umask 077
: "$ALL230_V1_FULL_SCOPE_APPROVED" "$ALL230_V1_SECURE_CUSTODY_APPROVED"
: "$ALL230_V1_SOURCE_PROJECT_REF" "$ALL230_V1_AGE_RECIPIENT" "$ALL230_V1_ARCHIVE_DIRECTORY"
: "$PGHOST" "$PGUSER" "$PGDATABASE" "$PGSSLMODE" "$PGSSLROOTCERT"
[[ "$ALL230_V1_FULL_SCOPE_APPROVED" == YES && "$ALL230_V1_SECURE_CUSTODY_APPROVED" == YES ]] || { echo 'BLOCKED: operator approvals';exit 2; }
[[ "$ALL230_V1_SOURCE_PROJECT_REF" == impulecgsgaruvniuttc && "$PGDATABASE" == postgres && "$PGSSLMODE" == verify-full ]] || { echo 'BLOCKED: wrong source/TLS';exit 2; }
[[ -r "$PGSSLROOTCERT" ]] || { echo 'BLOCKED: TLS CA missing';exit 2; }
if [[ -n "$(printenv PGPASSFILE 2>/dev/null || true)" ]]; then
 [[ -r "$PGPASSFILE" && "$(stat -c %a "$PGPASSFILE")" == 600 ]] || { echo 'BLOCKED: password file must be readable 0600';exit 2; }
elif [[ -z "$(printenv PGPASSWORD 2>/dev/null || true)" ]]; then
 echo 'BLOCKED: enter V1 password into transient PGPASSWORD or protected 0600 PGPASSFILE';exit 2
fi
if [[ "$PGHOST" == db.impulecgsgaruvniuttc.supabase.co ]]; then
 [[ "$PGUSER" == postgres ]] || { echo 'BLOCKED: wrong V1 direct role';exit 2; }
elif [[ "$PGHOST" == *.pooler.supabase.com ]]; then
 [[ "$PGUSER" == postgres.impulecgsgaruvniuttc ]] || { echo 'BLOCKED: wrong V1 pooler role';exit 2; }
else
 echo 'BLOCKED: unrecognized V1 endpoint';exit 2
fi
[[ "$ALL230_V1_AGE_RECIPIENT" =~ ^age1[a-z0-9]{50,90}$ ]] || { echo 'BLOCKED: invalid age recipient';exit 2; }
[[ -d "$ALL230_V1_ARCHIVE_DIRECTORY" && ! -L "$ALL230_V1_ARCHIVE_DIRECTORY" ]] || { echo 'BLOCKED: output directory';exit 2; }
DIR="$(cd "$ALL230_V1_ARCHIVE_DIRECTORY" && pwd -P)"
[[ "$DIR" == "$HOME/.allin365-recovery/backups" && "$(stat -c %a "$DIR")" == 700 ]] || { echo 'BLOCKED: non-private output directory';exit 2; }
for cmd in pg_dump age sha256sum openssl stat;do command -v "$cmd" >/dev/null || { echo "BLOCKED: missing $cmd";exit 2; };done
pg_dump --version | grep -Eq ' 17[.]' || { echo 'BLOCKED: need pg_dump 17';exit 2; }
[[ "$(printenv CI 2>/dev/null || true)" != true && "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != true ]] || { echo 'BLOCKED: no CI capture';exit 2; }
PREFIX="all230-v1-approved-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8)"
capture() {
 label="$1";shift
 enc="$DIR/$PREFIX.$label.dump.age"
 part="$enc.part"
 receipt="$DIR/$PREFIX.$label.capture.json"
 [[ ! -e "$part" && ! -e "$enc" && ! -e "$receipt" ]] || { echo 'BLOCKED: overwrite';exit 2; }
 started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
 if ! (set -o pipefail; PGOPTIONS='-c default_transaction_read_only=on' pg_dump --format=custom --no-owner --no-acl "$@" | age -r "$ALL230_V1_AGE_RECIPIENT" > "$part"); then
  rm -f "$part";echo "FAIL: $label";exit 1
 fi
 [[ -s "$part" ]] || { rm -f "$part";echo 'FAIL: empty archive';exit 1; }
 sha="$(sha256sum "$part" | cut -d ' ' -f 1)"
 ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
 mv -n "$part" "$enc";chmod 600 "$enc"
 printf '{"sourceProjectRef":"impulecgsgaruvniuttc","scope":"%s","ciphertextSha256":"%s","startedUtc":"%s","completedUtc":"%s","unifiedCutoffVerified":false,"independentReviewerAccepted":false,"externalImportHistoryVerified":false,"privateStorageBytesCaptured":false,"initialCertificationAuthorized":false}\n' "$label" "$sha" "$started" "$ended" > "$receipt.part"
 chmod 600 "$receipt.part";mv -n "$receipt.part" "$receipt"
 echo "ENCRYPTED $label CAPTURED (not independently attested)"
}
# Every scope uses its OWN MVCC snapshot, so no unified point-in-time claim.
# App includes schema/data/functions which must be sanitized before restore.
capture app --schema=public --schema=allin_private
# Actual Auth users/identities, NEVER live sessions/refresh tokens/MFA material.
capture auth_identity --table=auth.users --table=auth.identities
# Storage database metadata, NOT the actual private object bytes.
capture storage_catalog --table=storage.buckets --table=storage.objects
echo 'Three encrypted archives and private receipts captured.'
echo 'NOT PASSED: independent source custody, provider/import jobs, unified cutoff, Auth sign-in or Storage byte restore.'
