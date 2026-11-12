#!/usr/bin/env python3
"""ALL-228: one-time local staging credential enrollment, no secret ever logged.

From a trusted computer, after authenticating gh and obtaining the TEMPORARY
Supabase project's postgres database password:
  python scripts/provision-v2-ingredient-temp-login.py

Requires psql and gh on PATH. Python prompts securely using getpass;\npsql stdin is reserved for SQL, not for interactive password input.
Generates a fresh cryptographic workload password in memory; stores only an
exact-project .pgpass record in the existing protected GitHub environment.
Neither password nor generated SQL is displayed or written to disk.

This intentionally cannot provision production. Expires the workload registry
after 45 minutes; the project's deletion is separately scheduled.
"""
import os
import getpass
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
                   input=pgpass, text=True, check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
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
    # psql cannot read an interactive -W password from stdin when SQL is
    # supplied through subprocess.run(input=sql). Read from the local console
    # first and pass only to the child process environment, never CLI args,
    # script text, GitHub or a plaintext file.
    command = ["psql", "-X", "-v", "ON_ERROR_STOP=1",
               "-h", host, "-p", "5432", "-U", "postgres." + PROJECT,
               "-d", "postgres", "-w", "-q", "-f", "-"]
    admin_password = getpass.getpass("TEMP project database password (hidden): ")
    if not admin_password:
        raise RuntimeError("Empty temporary database password refused")
    child_env = {**env, "PGPASSWORD": admin_password}
    del admin_password
    diagnostic = "unclassified database activation failure"
    try:
        try:
            result = subprocess.run(command, input=sql, text=True, env=child_env,
                                    check=False, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE)
            if result.returncode != 0:
                # Diagnostics are bucketed without printing the SQL, raw
                # stderr or credentials. Password and random role secret never
                # appear in user-visible output, even if psql echoes its input.
                err = (result.stderr or "").lower()
                if "password authentication failed" in err:
                    diagnostic = "temporary database password authentication rejected"
                elif "certificate" in err or "ssl" in err or "tls" in err:
                    diagnostic = "database TLS verification failed"
                elif "could not translate host" in err or "could not connect" in err:
                    diagnostic = "database host or network connection failed"
                elif "permission denied" in err or "must be" in err or "not permitted" in err:
                    diagnostic = "database privilege denied during activation"
                elif "violates check constraint" in err:
                    diagnostic = "operator registry validation rejected activation"
                elif "syntax error" in err:
                    diagnostic = "activation SQL syntax error"
                elif "connection to server" in err:
                    diagnostic = "database session connection was interrupted"
                else:
                    diagnostic = "database rejected activation SQL (details withheld)"
                raise RuntimeError(diagnostic)
        finally:
            child_env.pop("PGPASSWORD", None)
    except Exception:
        # Do not leave a future hosted workflow with a stale usable secret.
        subprocess.run(["gh", "secret", "delete", SECRET_NAME, "--env", ENVIRONMENT,
                        "--repo", REPO], check=False, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        raise RuntimeError("Database activation failed: " + diagnostic +
                           "; GitHub secret deletion attempted. Inspect restricted role state.")
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
