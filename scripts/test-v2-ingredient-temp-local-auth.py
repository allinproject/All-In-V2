#!/usr/bin/env python3
"""ALL-228: one-shot independently authenticated hosted login proof, local only.
Temporary project only. Never prints passwords, SQL source, or PostgreSQL
diagnostics containing potentially sensitive information. No GitHub workflow.
"""
import getpass
import json
import os
import secrets
import shutil
import subprocess
import sys

PROJECT = "fbtgknlxjyeqrxemskbl"
HOST = "aws-1-us-east-1.pooler.supabase.com"
LOGIN = "allin_ing_workload_temp_local228"
REPO = "allinproject/All-In-V2"
ENVIRONMENT = "all251-temporary-staging"
OLD_SECRET = "ALL228_TEMP_STAGING_PGPASS_LINE"


def connection_env(password, cert):
    result = dict(os.environ)
    for key in ("PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER",
                "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSFILE",
                "PGSSLMODE", "PGSSLROOTCERT", "DATABASE_URL", "PGURI"):
        result.pop(key, None)
    result["PGSSLMODE"] = "verify-full"
    result["PGSSLROOTCERT"] = cert
    result["PGPASSWORD"] = password
    return result


def psql(user, password, ca, sql):
    command = ["psql", "-X", "-w", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
               "-h", HOST, "-p", "5432", "-d", "postgres",
               "-U", user + "." + PROJECT, "-f", "-"]
    completed = subprocess.run(
        command, input=sql, encoding="utf-8",
        env=connection_env(password, ca), stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=35)
    if completed.returncode != 0:
        # Never echo raw stderr because SQL error context could reveal secret.
        error = completed.stderr.lower()
        category = ("authentication" if "password authentication failed" in error
                    else "TLS" if "certificate" in error or "ssl" in error
                    else "permissions" if "permission denied" in error
                    else "connectivity" if "connection" in error
                    else "database query")
        raise RuntimeError("Temporary database " + category + " failed; no credentials printed")
    return completed.stdout


def main():
    if not shutil.which("psql"):
        raise RuntimeError("PostgreSQL psql is missing from PATH")
    ca = os.environ.get("ALL228_STAGING_CA_CERT", "")
    if not ca or not os.path.isfile(ca):
        raise RuntimeError("Trusted temporary Supabase CA file path not set")
    if not sys.stdin.isatty():
        raise RuntimeError("Run interactively in PowerShell")
    print("ALL-228 real authenticated test — temporary project " + PROJECT)
    if input("Type TEMP to run the local read-only login proof: ").strip() != "TEMP":
        raise RuntimeError("Cancelled")
    admin_password = getpass.getpass("TEMP database administrator password (hidden): ")
    if not admin_password:
        raise RuntimeError("Empty admin password rejected")

    # Hex is safely embedded in the server-side role password literal.
    workload_password = secrets.token_hex(32)
    activation = (
        "BEGIN;\n"
        f"ALTER ROLE {LOGIN} PASSWORD '{workload_password}';\n"
        "UPDATE allin_private.v2_ingredient_review_operators SET "
        "enabled=true, identity_verified_at=clock_timestamp(), "
        "credential_vault_reference='ALL228-local-ephemeral-verified', "
        "credential_expires_at=clock_timestamp()+interval '10 minutes' "
        f"WHERE login_role='{LOGIN}'::name AND enabled=false "
        "AND revoked_at IS NULL AND principal_kind='workload' "
        "AND identity_issuer='allin-v2-internal-workload' "
        "AND identity_subject='ingest-temp-local228-20261112';\n"
        "DO $check$ BEGIN IF NOT EXISTS (SELECT 1 FROM "
        "allin_private.v2_ingredient_review_operators "
        f"WHERE login_role='{LOGIN}'::name AND enabled "
        "AND credential_expires_at>clock_timestamp()) "
        "THEN RAISE EXCEPTION 'temporary workload identity not enabled'; "
        "END IF; END $check$;\nCOMMIT;\n"
    )
    # No mutations outside this confined, pre-enrolled temporary role.
    activated = False
    cleanup_ok = False
    try:
        psql("postgres", admin_password, ca, activation)
        activated = True
        print("Temporary 10-minute login activated; testing independent authentication...")
        proof_sql = (
            "BEGIN READ ONLY;\n"
            "SET LOCAL ROLE allin_v2_ingredient_reviewer;\n"
            "SELECT json_build_object("
            "'login',session_user::text,"
            "'effective_role',current_user::text,"
            "'reviewer_member',pg_has_role(session_user,'allin_v2_ingredient_reviewer','member'),"
            "'publisher_member',pg_has_role(session_user,'allin_v2_ingredient_publisher','member'),"
            "'schema_present',to_regclass('public.v2_ingredients') IS NOT NULL,"
            "'review_writer',to_regprocedure('allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)') IS NOT NULL,"
            "'can_execute_review',has_function_privilege(current_user,'allin_private.v2_review_ingredient_profile_status(uuid,integer,text,text,text,uuid)','EXECUTE'),"
            "'direct_update',has_table_privilege(session_user,'public.v2_ingredient_nutrition_profiles','UPDATE'),"
            "'private_audit_read',has_table_privilege(session_user,'allin_private.v2_ingredient_review_events','SELECT'),"
            "'schema_create',has_schema_privilege(session_user,'public','CREATE'),"
            "'privileged',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user "
            "AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))"
            ")::text;\nROLLBACK;\n"
        )
        output = psql(LOGIN, workload_password, ca, proof_sql)
        records = [s.strip() for s in output.splitlines() if s.strip().startswith("{")]
        if len(records) != 1:
            raise RuntimeError("No single trusted authenticated read-only proof")
        proof = json.loads(records[0])
        required = {"login": LOGIN, "effective_role": "allin_v2_ingredient_reviewer",
                    "reviewer_member": True, "publisher_member": False,
                    "schema_present": True, "review_writer": True,
                    "can_execute_review": True, "direct_update": False,
                    "private_audit_read": False, "schema_create": False,
                    "privileged": False}
        failures = [key for key, expected in required.items()
                    if proof.get(key) != expected]
        if failures:
            raise RuntimeError("Authenticated permission proof failed: " + ", ".join(failures))
        print("PASS independent Supabase login, reviewer-only capability and private-data denials.")
        print("No ingredient rows created. No publishing capability granted.")
    finally:
        # Revoke even if the authentication proof failed; bounded registry expiry
        # is the independent fallback if the admin cleanup connection fails.
        try:
            psql("postgres", admin_password, ca,
                 f"BEGIN; ALTER ROLE {LOGIN} PASSWORD NULL; "
                 "UPDATE allin_private.v2_ingredient_review_operators "
                 "SET enabled=false,credential_expires_at=clock_timestamp(),"
                 "revoked_at=clock_timestamp() "
                 f"WHERE login_role='{LOGIN}'::name AND revoked_at IS NULL; "
                 "COMMIT;")
            cleanup_ok = True
            print("PASS temporary workload revoked; database password cleared.")
        except Exception:
            print("WARNING: revocation could not be confirmed; credential expires within 10 minutes.")
        # Old protected secret belongs to the abandoned GitHub workflow. It
        # cannot authenticate the newly enrolled local-only login.
        if shutil.which("gh"):
            subprocess.run(["gh", "secret", "delete", OLD_SECRET, "--env",
                            ENVIRONMENT, "--repo", REPO],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=False)
        admin_password = None
        workload_password = None
        if not cleanup_ok and activated:
            raise RuntimeError("Temporary credential cleanup must be verified")

if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print("ALL-228 local acceptance: " + str(error), file=sys.stderr)
        raise SystemExit(1)
