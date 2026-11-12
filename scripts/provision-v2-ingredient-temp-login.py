#!/usr/bin/env python3
"""ALL-228: one-time local staging credential enrollment, no secret ever logged.

From a trusted computer, after authenticating gh and obtaining the TEMPORARY
Supabase project's postgres database password:
  python scripts/provision-v2-ingredient-temp-login.py

Requires psql and gh on PATH. Prompts for admin password in psql's own TTY.
Generates a fresh cryptographic workload password in memory; stores only an
exact-project .pgpass record in the existing protected GitHub environment.
Neither password nor generated SQL is displayed or written to disk.

This intentionally cannot provision production. Expires the workload registry
after 45 minutes; the project's deletion is separately scheduled.
"""
import os
import secrets
import shutil
import subprocess
import sys

PROJECT = "fbtgknlxjyeqrxemskbl"
LOGIN = "allin_ing_workload_temp_all228"
REPO = "allinproject/All-In-V2"
ENVIRONMENT = "all251-temporary-staging"
SECRET_NAME = "ALL228_TEMP_STAGING_PGPASS_LINE"
WORKFLOW = "v2-all228-temporary-hosted-workload.yml"


def require_tools():
    if not shutil.which("psql"):
        raise RuntimeError("psql not found. Install PostgreSQL client utilities first.")
    if not shutil.which("gh"):
        raise RuntimeError("GitHub CLI (gh) not found. Install and sign in with gh auth login.")
    subprocess.run(["gh", "auth", "status"], check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


def safe_environment():
    env = dict(os.environ)
    for key in ("PGPASSWORD", "PGPASSFILE", "DATABASE_URL", "PGURI", "PGHOSTADDR",
                "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGCONNECT_TIMEOUT",
                "PGTARGETSESSIONATTRS", "PGSSLMODE", "PGHOST", "PGPORT", "PGUSER",
                "PGDATABASE"):
        env.pop(key, None)
    # libpq verifies host name and certificate against the given CA bundle.
    cert = env.get("ALL228_STAGING_CA_CERT")
    if not cert or not os.path.isfile(cert):
        raise RuntimeError("Set ALL228_STAGING_CA_CERT to the trusted root CA bundle (PEM).")
    env["PGSSLMODE"] = "verify-full"
    env["PGSSLROOTCERT"] = cert
    return env


def provision():
    require_tools()
    env = safe_environment()
    # Hex has no .pgpass or SQL quoting special characters.
    secret = secrets.token_hex(32)
    if not sys.stdin.isatty():
        raise RuntimeError("Run interactively so psql can securely prompt for admin password.")
    print("Target: temporary project " + PROJECT)
    host = input("Paste the SESSION POOLER hostname from that project's Supabase Connect panel: ").strip()
    if not __import__("re").fullmatch(r"[a-z0-9-]+\.pooler\.supabase\.com", host):
        raise RuntimeError("Only a verified Supabase session pooler hostname is accepted.")
    print("This will configure the restricted login for 45 minutes and dispatch")
    print("the existing read-only hosted authentication workflow. No production changes.")
    answer = input("Type TEMP to confirm this exact temporary project: ").strip()
    if answer != "TEMP":
        raise RuntimeError("Cancelled without provisioning.")
    # Supavisor session mode is IPv4 compatible for GitHub Actions.
    pgpass = f"{host}:5432:postgres:{LOGIN}.{PROJECT}:{secret}\n"
    print("Saving protected GitHub environment secret (never displayed)...")
    subprocess.run(["gh", "secret", "set", SECRET_NAME,
                    "--env", ENVIRONMENT, "--repo", REPO],
                   input=pgpass, text=True, check=True, stdout=subprocess.DEVNULL)
    # SQL is fed via stdin, not CLI arguments, shell history or temporary files.
    # A failed transaction does not leave partial operator activation.
    sql = (
        "BEGIN;\n"
        f"ALTER ROLE {LOGIN} PASSWORD '{secret}';\n"
        "UPDATE allin_private.v2_ingredient_review_operators\n"
        "SET enabled=true, identity_verified_at=clock_timestamp(),\n"
        "credential_vault_reference='gh-actions-all251-temporary-staging',\n"
        "credential_expires_at=clock_timestamp()+interval '45 minutes'\n"
        f"WHERE login_role='{LOGIN}'::name AND principal_kind='workload'\n"
        "AND identity_issuer='allin-v2-internal-workload'\n"
        "AND identity_subject='ingest-temp-all228-20261112'\n"
        "AND enabled=false;\n"
        "DO $gate$ BEGIN IF NOT EXISTS (SELECT 1 FROM "
        "allin_private.v2_ingredient_review_operators "
        f"WHERE login_role='{LOGIN}'::name AND enabled "
        "AND credential_expires_at>clock_timestamp()) "
        "THEN RAISE EXCEPTION 'Refusing nonexistent or already enabled staging identity'; "
        "END IF; END $gate$;\n"
        "COMMIT;\n"
    )
    command = ["psql", "-X", "-v", "ON_ERROR_STOP=1",
               "-h", host, "-p", "5432", "-U", "postgres." + PROJECT,
               "-d", "postgres", "-W", "-q", "-f", "-"]
    try:
        print("psql will prompt for this TEMP project admin database password.")
        subprocess.run(command, input=sql, text=True, env=env,
                       check=True, stdout=subprocess.DEVNULL)
    except Exception:
        # Do not leave a future hosted workflow with a stale usable secret.
        subprocess.run(["gh", "secret", "delete", SECRET_NAME, "--env", ENVIRONMENT,
                        "--repo", REPO], check=False, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        raise RuntimeError("Database activation failed; GitHub secret deletion attempted. "
                           "Inspect restricted role state before retrying.")
    del sql
    del pgpass
    del secret
    print("Restricted staging login configured; dispatching read-only login test.")
    subprocess.run(["gh", "workflow", "run", WORKFLOW,
                    "--ref", "integration/v2-foundation", "--repo", REPO,
                    "-f", "session_pooler_host=" + host],
                   check=True)
    print("Check GitHub Actions for the run. Revoke the staging role and")
    print("delete the GitHub secret after tests; do not extend project lifetime.")


if __name__ == "__main__":
    try:
        provision()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print("ALL-228 setup stopped: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
